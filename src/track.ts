import * as THREE from 'three';

export interface TrackSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  distance: number;
  width: number;
}

export interface ProjectResult {
  sample: TrackSample;
  index: number;
  segmentT: number;
  projected: THREE.Vector3;
}

export type WidthProfile = (t: number) => number;

let cachedRoadMaterial: THREE.MeshStandardMaterial | null = null;

export class TrackSurface {
  readonly mesh: THREE.Mesh;
  readonly samples: TrackSample[];
  readonly totalLength: number;
  private readonly segmentCount: number;
  readonly width: number;

  constructor(options: {
    curve: THREE.CatmullRomCurve3;
    width: number;
    segments?: number;
    widthProfile?: WidthProfile;
  }) {
    const { curve, width, segments = 500, widthProfile } = options;
    this.segmentCount = segments;
    this.width = width;
    const frames = curve.computeFrenetFrames(segments, false);
    const points = curve.getPoints(segments);
    const lengths = curve.getLengths(segments);
    const indices: number[] = [];
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const samples: TrackSample[] = [];
    const lengthScale = curve.getLength() / 12;
    const bankMatrix = new THREE.Matrix4();

    for (let i = 0; i <= segments; i += 1) {
      const point = points[i].clone();
      const tNorm = i / segments;
      const localWidth = widthProfile ? widthProfile(tNorm) : width;
      const tangent = frames.tangents[i].clone();
      const binormal = frames.binormals[i].clone();

      const crestDamp = THREE.MathUtils.lerp(
        0.38,
        1,
        THREE.MathUtils.smoothstep(tNorm, 0.14, 0.32),
      );

      const undulation =
        (Math.sin(tNorm * Math.PI * 5.1 + 0.3) * 4.6 +
          Math.sin(tNorm * Math.PI * 11.7 + 1.2) * 1.8) *
        crestDamp;
      point.y += undulation;

      const bankAngle =
        (Math.sin(tNorm * Math.PI * 3.4 + 0.8) * THREE.MathUtils.degToRad(5.4) +
          Math.sin(tNorm * Math.PI * 8.7 + 1.9) * THREE.MathUtils.degToRad(2.2)) *
        crestDamp;
      bankMatrix.makeRotationAxis(tangent, bankAngle);
      binormal.applyMatrix4(bankMatrix);

      const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

      const left = point.clone().addScaledVector(binormal, localWidth * 0.5);
      const right = point.clone().addScaledVector(binormal, -localWidth * 0.5);

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);

      const v = lengths[i] / lengthScale;
      uvs.push(0, v, 1, v);

      samples.push({
        position: point.clone(),
        tangent,
        normal,
        binormal: binormal.clone(),
        distance: lengths[i],
        width: localWidth,
      });
    }

    for (let i = 0; i < segments; i += 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 2, base + 3, base + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, getRoadMaterial());
    this.mesh.receiveShadow = true;

    this.samples = samples;
    this.totalLength = lengths[segments];
  }

  getSampleAtDistance(distance: number): TrackSample {
    const clamped = THREE.MathUtils.clamp(distance, 0, this.totalLength);
    const target = clamped / this.totalLength;
    const index = target * this.segmentCount;
    const i0 = Math.floor(index);
    const i1 = Math.min(i0 + 1, this.samples.length - 1);
    const t = index - i0;
    return TrackSurface.interpolateSample(this.samples[i0], this.samples[i1], t);
  }

  projectPoint(position: THREE.Vector3): ProjectResult {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestResult: ProjectResult | null = null;
    const segment = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const projected = new THREE.Vector3();
    for (let i = 0; i < this.samples.length - 1; i += 1) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      segment.copy(b.position).sub(a.position);
      const lengthSq = segment.lengthSq();
      if (lengthSq === 0) {
        continue;
      }
      const t = THREE.MathUtils.clamp(
        toPoint.copy(position).sub(a.position).dot(segment) / lengthSq,
        0,
        1,
      );
      projected.copy(a.position).addScaledVector(segment, t);
      const dist = projected.distanceToSquared(position);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestResult = {
          sample: TrackSurface.interpolateSample(a, b, t),
          index: i,
          segmentT: t,
          projected: projected.clone(),
        };
      }
    }
    if (!bestResult) {
      const last = this.samples[this.samples.length - 1];
      bestResult = {
        sample: last,
        index: this.samples.length - 1,
        segmentT: 0,
        projected: last.position.clone(),
      };
    }
    return bestResult;
  }

  private static interpolateSample(a: TrackSample, b: TrackSample, t: number): TrackSample {
    const position = a.position.clone().lerp(b.position, t);
    const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();
    const normal = a.normal.clone().lerp(b.normal, t).normalize();
    const binormal = a.binormal.clone().lerp(b.binormal, t).normalize();
    const distance = THREE.MathUtils.lerp(a.distance, b.distance, t);
    const width = THREE.MathUtils.lerp(a.width, b.width, t);
    return { position, tangent, normal, binormal, distance, width };
  }
}

export function createMountainTrack(): TrackSurface {
  const controlPoints = [
    new THREE.Vector3(0, 168, 0),
    new THREE.Vector3(-22, 162, -62),
    new THREE.Vector3(-48, 152, -134),
    new THREE.Vector3(-10, 140, -206),
    new THREE.Vector3(54, 126, -276),
    new THREE.Vector3(94, 112, -346),
    new THREE.Vector3(46, 96, -412),
    new THREE.Vector3(-32, 82, -468),
    new THREE.Vector3(-76, 70, -522),
    new THREE.Vector3(-28, 56, -582),
    new THREE.Vector3(30, 40, -640),
    new THREE.Vector3(74, 24, -706),
    new THREE.Vector3(20, 10, -770),
    new THREE.Vector3(-40, -8, -832),
    new THREE.Vector3(-66, -26, -894),
    new THREE.Vector3(-22, -48, -954),
    new THREE.Vector3(40, -74, -1014),
    new THREE.Vector3(88, -104, -1072),
    new THREE.Vector3(32, -136, -1132),
    new THREE.Vector3(-44, -164, -1190),
    new THREE.Vector3(-18, -194, -1248),
    new THREE.Vector3(42, -222, -1306),
    new THREE.Vector3(86, -252, -1364),
    new THREE.Vector3(28, -280, -1422),
    new THREE.Vector3(-34, -306, -1480),
  ];

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal', 0.12);
  const widthProfile: WidthProfile = (t) => {
    const base = 21;
    const rolling = Math.sin(t * Math.PI * 4.8 + 0.3) * 2.6;
    const canyon = Math.exp(-Math.pow((t - 0.6) * 5.1, 2)) * -4.8;
    const overlook = Math.exp(-Math.pow((t - 0.22) * 6, 2)) * 3.4;
    const finale = Math.exp(-Math.pow((t - 0.86) * 7.6, 2)) * -2.6;
    return THREE.MathUtils.clamp(base + rolling + canyon + overlook + finale, 16, 24.5);
  };
  return new TrackSurface({ curve, width: 21, widthProfile, segments: 1200 });
}

function getRoadMaterial(): THREE.MeshStandardMaterial {
  if (cachedRoadMaterial) {
    return cachedRoadMaterial;
  }
  const texture = createRoadTexture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 32);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;

  cachedRoadMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.55,
    metalness: 0.04,
    envMapIntensity: 0.65,
    side: THREE.DoubleSide,
  });

  return cachedRoadMaterial;
}

function createRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable for road texture.');
  }

  const gradient = ctx.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, '#2c3445');
  gradient.addColorStop(1, '#1f2736');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < 1800; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const size = Math.random() * 2.4;
    ctx.fillRect(x, y, size, size);
  }

  const edgeWidth = 10;
  ctx.fillStyle = 'rgba(220, 232, 255, 0.55)';
  ctx.fillRect(0, 0, edgeWidth, canvas.height);
  ctx.fillRect(canvas.width - edgeWidth, 0, edgeWidth, canvas.height);

  const centerSpacing = 12;
  const lineWidth = 8;
  const dashHeight = 120;
  const gap = 100;
  const centerX = canvas.width * 0.5;
  ctx.fillStyle = '#f5c043';
  for (let y = -dashHeight; y < canvas.height + gap; y += dashHeight + gap) {
    ctx.fillRect(centerX - centerSpacing - lineWidth, y, lineWidth, dashHeight);
    ctx.fillRect(centerX + centerSpacing, y, lineWidth, dashHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
