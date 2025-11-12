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

    // DEBUG: Check elevation range
    let minY = Infinity, maxY = -Infinity;
    points.forEach(p => {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    console.log(`✅ Track geometry: ${segments + 1} points, Y range: ${minY.toFixed(1)}-${maxY.toFixed(1)} (elevation: ${(maxY - minY).toFixed(1)}m) - SLOPED SURFACE`);
    const indices: number[] = [];
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const samples: TrackSample[] = [];
    const tempNormals: THREE.Vector3[] = []; // Store normals for smoothing pass
    const lengthScale = curve.getLength() / 12;
    const bankMatrix = new THREE.Matrix4();

    for (let i = 0; i <= segments; i += 1) {
      const point = points[i].clone();
      const tNorm = i / segments;
      const localWidth = widthProfile ? widthProfile(tNorm) : width;

      // PARALLEL TRANSPORT FRAMES: Rotation-minimizing frames to eliminate warping
      // This prevents the twisting/torsion that Frenet frames introduce on tight curves
      // - Tangent follows the curve (includes elevation)
      // - Binormal is transported with minimal rotation (prevents twisting)
      // - Normal is perpendicular to both (surface normal, will tilt on slopes)

      // Compute tangent directly from curve points (avoid Frenet tangents which include torsion)
      let tangent: THREE.Vector3;
      if (i === 0) {
        tangent = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
      } else if (i === segments) {
        tangent = new THREE.Vector3().subVectors(points[segments], points[segments - 1]).normalize();
      } else {
        // Central difference for smoother tangents
        tangent = new THREE.Vector3().subVectors(points[i + 1], points[i - 1]).normalize();
      }

      const worldUp = new THREE.Vector3(0, 1, 0);

      // HORIZONTAL BINORMAL: Force binormal to always be horizontal (perpendicular to world up)
      // This ensures flat, level cross-sections at all times - no warping possible
      let binormal: THREE.Vector3;

      if (Math.abs(tangent.dot(worldUp)) > 0.99) {
        // Tangent is nearly vertical - use fallback horizontal direction
        binormal = new THREE.Vector3(1, 0, 0);
      } else {
        // Cross product: worldUp × tangent = horizontal right direction
        // This ALWAYS produces a horizontal binormal regardless of curve changes
        binormal = new THREE.Vector3().crossVectors(worldUp, tangent).normalize();
      }

      // Normal points upward-ish, perpendicular to both tangent and binormal
      // Cross product: tangent × binormal = normal (right-hand rule)
      const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize();
      tempNormals.push(normal); // Store for smoothing

      // Create left/right vertices along binormal
      // The parallel transport frames ensure the binormal doesn't twist,
      // so these vertices naturally form flat cross-sections
      const left = point.clone().addScaledVector(binormal, localWidth * 0.5);
      const right = point.clone().addScaledVector(binormal, -localWidth * 0.5);

      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      // Normals will be added after smoothing pass
      normals.push(0, 0, 0, 0, 0, 0); // Placeholder

      const v = lengths[i] / lengthScale;
      uvs.push(0, v, 1, v);

      // Temporarily store with unsmoothed normal - will update after smoothing
      samples.push({
        position: point.clone(),
        tangent,
        normal, // Will be replaced with smoothed version
        binormal: binormal.clone(),
        distance: lengths[i],
        width: localWidth,
      });
    }

    // SMOOTH NORMALS PASS: Average normals with neighbors to eliminate micro-stepping
    // This creates gradual transitions that the suspension physics can handle smoothly
    const smoothedNormals: THREE.Vector3[] = [];
    const smoothRadius = 20; // Smooth over ±20 segments (41 total) - very aggressive smoothing

    for (let i = 0; i < tempNormals.length; i++) {
      const avgNormal = new THREE.Vector3();
      let count = 0;

      for (let j = Math.max(0, i - smoothRadius); j <= Math.min(tempNormals.length - 1, i + smoothRadius); j++) {
        avgNormal.add(tempNormals[j]);
        count++;
      }

      avgNormal.divideScalar(count).normalize();
      smoothedNormals.push(avgNormal);

      // Update samples array with smoothed normal
      samples[i].normal = avgNormal.clone();

      // Update normals array with smoothed values (2 vertices per sample, same normal for both)
      const idx = i * 6; // 6 floats per sample (2 vertices × 3 components)
      normals[idx] = avgNormal.x;
      normals[idx + 1] = avgNormal.y;
      normals[idx + 2] = avgNormal.z;
      normals[idx + 3] = avgNormal.x;
      normals[idx + 4] = avgNormal.y;
      normals[idx + 5] = avgNormal.z;
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

    // CRITICAL: DO NOT call computeVertexNormals() - we use Frenet frame normals
    geometry.computeBoundingSphere();

    // Use the proper road material with texture
    this.mesh = new THREE.Mesh(geometry, getRoadMaterial());
    this.mesh.receiveShadow = true;

    // Verify mesh elevation range
    const posAttr = geometry.getAttribute('position');
    let minMeshY = Infinity, maxMeshY = -Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      minMeshY = Math.min(minMeshY, y);
      maxMeshY = Math.max(maxMeshY, y);
    }
    console.log(`✅ Mesh elevation: min=${minMeshY.toFixed(1)}m, max=${maxMeshY.toFixed(1)}m, drop=${(maxMeshY - minMeshY).toFixed(1)}m`);

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
  // MOUNTAIN TOUGE - Elevation changes create realistic mountain pass
  // Overall descent from 120m to 40m (80m drop)
  // Mix of downhill, uphill, and flat sections for dynamic driving

  return [
    // === START - Mountain Summit (120m) ===
    new THREE.Vector3(0, 120, 0),
    new THREE.Vector3(0, 118, -20),      // Gentle start descent

    // === HAIRPIN 1 - Right (Steep descent into corner) ===
    new THREE.Vector3(5, 112, -45),       // Drop 6m approaching
    new THREE.Vector3(18, 105, -65),      // Drop 7m through entry
    new THREE.Vector3(35, 100, -75),      // Apex slightly higher
    new THREE.Vector3(50, 98, -72),       // Exit descent
    new THREE.Vector3(62, 95, -60),       // Continue down

    // === STRAIGHT + S-CURVE (Fast descent) ===
    new THREE.Vector3(75, 90, -40),       // 5m drop in straight
    new THREE.Vector3(85, 85, -15),       // Continuing down
    new THREE.Vector3(90, 82, 10),        // Slight compression
    new THREE.Vector3(92, 80, 35),        // Level out before hairpin

    // === HAIRPIN 2 - Left (Uphill hairpin!) ===
    new THREE.Vector3(95, 78, 55),        // Drop into entry
    new THREE.Vector3(105, 75, 72),       // Lowest point at apex
    new THREE.Vector3(122, 78, 82),       // CLIMB through exit! (+3m)
    new THREE.Vector3(140, 82, 80),       // Continue climbing
    new THREE.Vector3(155, 85, 68),       // Crest of climb

    // === MEDIUM SWEEPER (Downhill sweeper) ===
    new THREE.Vector3(170, 80, 50),       // Start descent again
    new THREE.Vector3(185, 72, 28),       // Fast descent (8m drop)
    new THREE.Vector3(195, 68, 5),        // Continuing down

    // === HAIRPIN 3 - Right (Blind crest entry) ===
    new THREE.Vector3(200, 65, -20),      // Slight climb to crest
    new THREE.Vector3(208, 62, -42),      // Drop over crest
    new THREE.Vector3(222, 58, -58),      // Steep descent through turn
    new THREE.Vector3(240, 54, -62),      // Continuing down
    new THREE.Vector3(258, 52, -55),      // Level exit

    // === FINAL SWEEPERS (Fast descent to finish) ===
    new THREE.Vector3(275, 48, -38),      // Gentle descent
    new THREE.Vector3(290, 45, -18),      // Continuing
    new THREE.Vector3(305, 42, 5),        // Almost at bottom

    // === FINISH - Valley Floor (40m) ===
    new THREE.Vector3(320, 40, 25),       // Final descent
    new THREE.Vector3(335, 40, 40),       // Level finish
    new THREE.Vector3(350, 40, 50),       // Finish line

    // Total elevation change: 80m descent (120m → 40m)
    // Features: Steep descents, uphill hairpin, blind crests, fast downhill sweepers
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
