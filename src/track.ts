import * as THREE from 'three';

export interface TrackSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  distance: number;
}

export interface ProjectResult {
  sample: TrackSample;
  index: number;
  segmentT: number;
  projected: THREE.Vector3;
}

export class TrackSurface {
  readonly mesh: THREE.Mesh;
  readonly samples: TrackSample[];
  readonly totalLength: number;
  private readonly segmentCount: number;
  readonly width: number;

  constructor(options: { curve: THREE.CatmullRomCurve3; width: number; segments?: number }) {
    const { curve, width, segments = 500 } = options;
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
    const lengthScale = curve.getLength() / 20;

    for (let i = 0; i <= segments; i += 1) {
      const point = points[i];
      const binormal = frames.binormals[i];
      const normal = new THREE.Vector3().crossVectors(binormal, frames.tangents[i]).normalize();

      const left = point.clone().addScaledVector(binormal, width * 0.5);
      const right = point.clone().addScaledVector(binormal, -width * 0.5);

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);

      const v = lengths[i] / lengthScale;
      uvs.push(0, v, 1, v);

      samples.push({
        position: point.clone(),
        tangent: frames.tangents[i].clone(),
        normal,
        binormal: binormal.clone(),
        distance: lengths[i],
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

    const material = new THREE.MeshStandardMaterial({
      color: 0x3a4256,
      metalness: 0.05,
      roughness: 0.65,
      side: THREE.DoubleSide,
      envMapIntensity: 0.6,
    });

    this.mesh = new THREE.Mesh(geometry, material);
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
    return { position, tangent, normal, binormal, distance };
  }
}

export function createMountainTrack(): TrackSurface {
  const controlPoints = [
    new THREE.Vector3(0, 65, 0),
    new THREE.Vector3(-18, 63, -40),
    new THREE.Vector3(-30, 60, -95),
    new THREE.Vector3(10, 56, -140),
    new THREE.Vector3(36, 52, -190),
    new THREE.Vector3(24, 47, -240),
    new THREE.Vector3(-12, 42, -290),
    new THREE.Vector3(-32, 37, -340),
    new THREE.Vector3(-6, 30, -390),
    new THREE.Vector3(22, 24, -440),
    new THREE.Vector3(14, 19, -490),
    new THREE.Vector3(-18, 13, -540),
    new THREE.Vector3(-6, 6, -590),
  ];

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.18);
  return new TrackSurface({ curve, width: 12, segments: 600 });
}
