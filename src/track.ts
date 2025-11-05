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

      // No undulation - keep road surface geometrically consistent with computed normals
      // Real roads follow smooth gradients without artificial waves

      // NO banking - keep road flat for realistic driving
      // Real mountain roads don't have significant banking
      const bankAngle = 0;
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

function getDefaultTrackControlPoints(): THREE.Vector3[] {
  return [
    // === START - Summit approach ===
    new THREE.Vector3(0, 60, 0),
    new THREE.Vector3(-20, 59, -60),
    new THREE.Vector3(-35, 58, -120),

    // === RIGHT SWEEPER (downhill entry) ===
    new THREE.Vector3(-30, 56, -190),
    new THREE.Vector3(0, 54, -260),
    new THREE.Vector3(40, 52, -320),
    new THREE.Vector3(75, 50, -370),

    // === CHICANE LEFT-RIGHT (technical section) ===
    new THREE.Vector3(95, 48, -420),
    new THREE.Vector3(85, 46, -480),
    new THREE.Vector3(60, 44, -530),
    new THREE.Vector3(70, 42, -590),
    new THREE.Vector3(95, 40, -640),

    // === LONG LEFT SWEEPER (drift section 1) ===
    new THREE.Vector3(100, 38, -710),
    new THREE.Vector3(80, 36, -790),
    new THREE.Vector3(40, 34, -870),
    new THREE.Vector3(-10, 32, -940),
    new THREE.Vector3(-60, 30, -990),

    // === HAIRPIN RIGHT (180° switchback) ===
    new THREE.Vector3(-95, 28, -1030),
    new THREE.Vector3(-110, 26, -1080),
    new THREE.Vector3(-100, 24, -1140),
    new THREE.Vector3(-60, 22, -1180),
    new THREE.Vector3(-10, 20, -1200),

    // === FAST STRAIGHT (downhill blast) ===
    new THREE.Vector3(45, 18, -1220),
    new THREE.Vector3(90, 16, -1250),

    // === DOUBLE APEX RIGHT (tricky corner) ===
    new THREE.Vector3(120, 14, -1300),
    new THREE.Vector3(130, 12, -1370),
    new THREE.Vector3(125, 10, -1450),

    // === S-CURVES (flowing transitions) ===
    new THREE.Vector3(100, 8, -1520),
    new THREE.Vector3(60, 6, -1580),
    new THREE.Vector3(40, 4, -1650),
    new THREE.Vector3(50, 2, -1720),
    new THREE.Vector3(80, 0, -1780),

    // === LONG RIGHT SWEEPER (drift section 2) ===
    new THREE.Vector3(115, -2, -1840),
    new THREE.Vector3(140, -4, -1920),
    new THREE.Vector3(150, -6, -2010),
    new THREE.Vector3(145, -8, -2100),
    new THREE.Vector3(120, -10, -2180),

    // === HAIRPIN LEFT (180° switchback) ===
    new THREE.Vector3(85, -12, -2240),
    new THREE.Vector3(60, -14, -2290),
    new THREE.Vector3(70, -16, -2350),
    new THREE.Vector3(110, -18, -2390),
    new THREE.Vector3(150, -20, -2410),

    // === DOWNHILL ESSES (final technical) ===
    new THREE.Vector3(170, -22, -2460),
    new THREE.Vector3(150, -24, -2530),
    new THREE.Vector3(120, -26, -2600),
    new THREE.Vector3(110, -28, -2680),
    new THREE.Vector3(130, -30, -2750),

    // === FINAL STRAIGHT (finish) ===
    new THREE.Vector3(150, -32, -2820),
    new THREE.Vector3(160, -34, -2900),
    new THREE.Vector3(165, -36, -2980),
  ];
}

export function saveTrackToStorage(points: THREE.Vector3[]): void {
  const data = points.map(p => ({ x: p.x, y: p.y, z: p.z }));
  localStorage.setItem('savedTrack', JSON.stringify(data));
  console.log('✓ Track saved to browser storage');
}

export function loadTrackFromStorage(): THREE.Vector3[] | null {
  const saved = localStorage.getItem('savedTrack');
  if (!saved) return null;

  try {
    const data = JSON.parse(saved);
    return data.map((p: { x: number; y: number; z: number }) =>
      new THREE.Vector3(p.x, p.y, p.z)
    );
  } catch (e) {
    console.error('Failed to load saved track:', e);
    return null;
  }
}

export function resetTrackToDefault(): void {
  localStorage.removeItem('savedTrack');
  console.log('✓ Track reset to default');
}

export function getTrackControlPoints(): THREE.Vector3[] {
  // Try to load saved track, otherwise use default
  const saved = loadTrackFromStorage();
  if (saved) {
    console.log('📍 Loaded saved track from storage');
    return saved;
  }
  console.log('📍 Using default track');
  return getDefaultTrackControlPoints();
}

export function createMountainTrack(): TrackSurface {
  const controlPoints = getTrackControlPoints();
  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal', 0.12);

  // Constant width of 24m - narrower to prevent overlaps on tight corners
  // (You can adjust this value - smaller = tighter corners possible)
  return new TrackSurface({ curve, width: 24, segments: 1800 });
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
