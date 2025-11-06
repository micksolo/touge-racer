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

      // FORCE FLAT ROAD - Override Frenet frame to keep road horizontal
      // Touge roads should be flat, not banked
      const normal = new THREE.Vector3(0, 1, 0); // Always point straight up

      // Recalculate binormal to be perpendicular to tangent and up vector
      // This keeps the road flat while following the curve
      binormal.crossVectors(normal, tangent).normalize();

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
    // === START STRAIGHT - Acceleration zone ===
    new THREE.Vector3(0, 60, 0),
    new THREE.Vector3(0, 59, -80),
    new THREE.Vector3(0, 58, -150),

    // === HAIRPIN 1 - TIGHT RIGHT (R=25m) ===
    // Entry approach
    new THREE.Vector3(5, 57, -180),
    // Hairpin apex (very tight spacing!)
    new THREE.Vector3(20, 56, -200),
    new THREE.Vector3(30, 55, -205),
    new THREE.Vector3(38, 54, -200),
    // Exit
    new THREE.Vector3(45, 53, -185),

    // === MEDIUM RIGHT - Technical (R=50m) ===
    new THREE.Vector3(55, 52, -150),
    new THREE.Vector3(70, 51, -120),
    new THREE.Vector3(80, 50, -90),

    // === SHORT STRAIGHT - Transition ===
    new THREE.Vector3(85, 49, -50),
    new THREE.Vector3(85, 48, -10),

    // === HAIRPIN 2 - TIGHT LEFT (R=20m) ===
    // Entry
    new THREE.Vector3(82, 47, 15),
    // Very tight apex
    new THREE.Vector3(70, 46, 28),
    new THREE.Vector3(55, 45, 32),
    new THREE.Vector3(42, 44, 28),
    // Exit
    new THREE.Vector3(30, 43, 15),

    // === S-CURVE - Medium left→right ===
    new THREE.Vector3(20, 42, -10),
    new THREE.Vector3(15, 41, -35),
    new THREE.Vector3(20, 40, -60),
    new THREE.Vector3(35, 39, -80),

    // === FAST SWEEPER RIGHT - Long drift (R=80m) ===
    new THREE.Vector3(55, 38, -100),
    new THREE.Vector3(80, 37, -110),
    new THREE.Vector3(105, 36, -115),
    new THREE.Vector3(125, 35, -110),

    // === TIGHT CHICANE - Left→Right ===
    new THREE.Vector3(140, 34, -95),
    new THREE.Vector3(145, 33, -75),
    new THREE.Vector3(145, 32, -50),
    new THREE.Vector3(140, 31, -30),

    // === HAIRPIN 3 - TIGHT RIGHT (R=18m) - Most technical ===
    // Entry
    new THREE.Vector3(135, 30, -5),
    // Ultra tight apex
    new THREE.Vector3(125, 29, 8),
    new THREE.Vector3(112, 28, 12),
    new THREE.Vector3(100, 27, 8),
    // Exit
    new THREE.Vector3(90, 26, -5),

    // === MEDIUM LEFT - Flowing (R=60m) ===
    new THREE.Vector3(75, 25, -30),
    new THREE.Vector3(55, 24, -50),
    new THREE.Vector3(35, 23, -60),

    // === FINAL HAIRPIN - TIGHT LEFT (R=22m) ===
    // Entry
    new THREE.Vector3(18, 22, -65),
    // Tight apex
    new THREE.Vector3(8, 21, -75),
    new THREE.Vector3(0, 20, -82),
    new THREE.Vector3(-8, 19, -75),
    // Exit to finish
    new THREE.Vector3(-15, 18, -60),

    // === FINISH STRAIGHT ===
    new THREE.Vector3(-20, 17, -30),
    new THREE.Vector3(-20, 16, 0),
    new THREE.Vector3(-15, 15, 30),
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

  // Wider touge-style track: 12m (comfortable for drifting)
  // Slightly wider than real touge for gameplay - allows full drift angles
  return new TrackSurface({ curve, width: 12, segments: 1800 });
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
