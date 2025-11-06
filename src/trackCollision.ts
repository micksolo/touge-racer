import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TrackSurface, type TrackSample } from './track';

/**
 * Generates collision boxes along a track using the segmented approach.
 * Each box is oriented using the track's tangent, normal, and binormal vectors.
 */
export function createTrackCollisionBodies(
  track: TrackSurface,
  world: CANNON.World,
  options?: {
    segmentLength?: number;  // Distance between collision boxes (meters)
    thickness?: number;       // Half-height of collision boxes (meters)
    overlap?: number;         // Overlap between segments (meters)
    material?: CANNON.Material;
  }
): CANNON.Body[] {
  const {
    segmentLength = 5,      // Sample every 5 meters
    thickness = 0.5,        // 1m thick collision volume
    overlap = 0.15,         // 15cm overlap to prevent gaps
    material,
  } = options || {};

  const bodies: CANNON.Body[] = [];
  const samples = track.samples;
  const trackWidth = track.width;

  // Calculate how many samples to skip between boxes
  const avgSegmentLength = track.totalLength / (samples.length - 1);
  const skipCount = Math.max(1, Math.floor(segmentLength / avgSegmentLength));

  console.log(`🏗️ Generating track collision:`);
  console.log(`   Total length: ${track.totalLength.toFixed(1)}m`);
  console.log(`   Samples: ${samples.length}`);
  console.log(`   Segment length: ${segmentLength}m (skip ${skipCount} samples)`);
  console.log(`   Box dimensions: ${trackWidth}m × ${thickness * 2}m × ${segmentLength + overlap}m`);

  // Create a box for each segment along the track
  for (let i = 0; i < samples.length - skipCount; i += skipCount) {
    const sample = samples[i];

    // Create oriented collision box
    const body = createOrientedBox(
      sample,
      trackWidth,
      thickness,
      segmentLength + overlap,  // Add overlap to prevent gaps
      material
    );

    world.addBody(body);
    bodies.push(body);
  }

  console.log(`✅ Created ${bodies.length} collision boxes`);

  // Verify and log sample transforms
  console.log(`🔍 Sample transforms and basis vectors (first 3):`);
  for (let i = 0; i < Math.min(3, bodies.length); i++) {
    const sample = samples[i * skipCount];
    const pos = bodies[i].position;

    // Verify basis is orthonormal (using flipped normal like the boxes)
    const tangent = sample.tangent;
    const upNormal = sample.normal.clone().multiplyScalar(-1);
    const binormal = sample.binormal;

    const dotTN = tangent.dot(upNormal);
    const dotTB = tangent.dot(binormal);
    const dotNB = upNormal.dot(binormal);

    console.log(`   Box ${i}:`);
    console.log(`     Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    console.log(`     Tangent:  (${tangent.x.toFixed(3)}, ${tangent.y.toFixed(3)}, ${tangent.z.toFixed(3)}) len=${tangent.length().toFixed(3)}`);
    console.log(`     Up Normal: (${upNormal.x.toFixed(3)}, ${upNormal.y.toFixed(3)}, ${upNormal.z.toFixed(3)}) len=${upNormal.length().toFixed(3)} [FLIPPED]`);
    console.log(`     Binormal: (${binormal.x.toFixed(3)}, ${binormal.y.toFixed(3)}, ${binormal.z.toFixed(3)}) len=${binormal.length().toFixed(3)}`);
    console.log(`     Orthogonality: T·N=${dotTN.toFixed(3)}, T·B=${dotTB.toFixed(3)}, N·B=${dotNB.toFixed(3)} (should be ~0)`);
  }

  return bodies;
}

/**
 * Creates a CANNON.Body with a box shape oriented according to track geometry.
 * Uses transform matrix from tangent/normal/binormal vectors.
 */
function createOrientedBox(
  sample: TrackSample,
  width: number,
  thickness: number,
  length: number,
  material?: CANNON.Material
): CANNON.Body {
  // Half-extents for the box
  const halfExtents = new CANNON.Vec3(
    width * 0.5,   // Half track width (left-right)
    thickness,     // Half thickness (up-down)
    length * 0.5   // Half segment length (forward-back)
  );

  const shape = new CANNON.Box(halfExtents);

  if (material) {
    shape.material = material;
  }

  // Build orientation quaternion from track vectors
  // NOTE: Track normal points DOWN, so we flip it to point UP for collision boxes
  const upNormal = sample.normal.clone().multiplyScalar(-1);

  // Convention: right = binormal (X), up = flipped normal (Y), forward = tangent (Z)
  const orientation = buildOrientationQuaternion(
    sample.tangent,
    upNormal,
    sample.binormal
  );

  const body = new CANNON.Body({
    mass: 0,  // Static
    shape,
    position: new CANNON.Vec3(
      sample.position.x,
      sample.position.y,
      sample.position.z
    ),
    quaternion: orientation,
    type: CANNON.Body.STATIC,
  });

  return body;
}

/**
 * Builds a CANNON quaternion from Three.js basis vectors.
 * Creates a rotation matrix then extracts the quaternion.
 *
 * @param tangent - Forward direction (track direction)
 * @param normal - Up direction (track surface normal)
 * @param binormal - Right direction (track cross-slope)
 */
function buildOrientationQuaternion(
  tangent: THREE.Vector3,
  normal: THREE.Vector3,
  binormal: THREE.Vector3
): CANNON.Quaternion {
  // Build rotation matrix from basis vectors
  // Matrix columns are: right (binormal), up (normal), forward (tangent)
  const matrix = new THREE.Matrix4();
  matrix.makeBasis(binormal, normal, tangent);

  // Extract quaternion from matrix
  const threeQuat = new THREE.Quaternion().setFromRotationMatrix(matrix);

  // Convert to CANNON quaternion
  return new CANNON.Quaternion(
    threeQuat.x,
    threeQuat.y,
    threeQuat.z,
    threeQuat.w
  );
}

/**
 * Creates a dedicated material for track surfaces.
 * Allows tuning friction independently from other surfaces.
 */
export function createTrackMaterial(options?: {
  friction?: number;
  restitution?: number;
}): CANNON.Material {
  const { friction = 0.7, restitution = 0.0 } = options || {};

  return new CANNON.Material({
    friction,
    restitution,
  });
}

/**
 * Optional: Create guardrail/wall bodies along track edges.
 * Prevents car from flying off the mountain.
 */
export function createTrackWalls(
  track: TrackSurface,
  world: CANNON.World,
  options?: {
    height?: number;
    offset?: number;
    segmentLength?: number;
  }
): CANNON.Body[] {
  const {
    height = 2,            // 2m tall walls
    offset = 12.5,         // 0.5m beyond track edge (24m/2 + 0.5)
    segmentLength = 10,    // Walls every 10m
  } = options || {};

  const bodies: CANNON.Body[] = [];
  const samples = track.samples;

  const avgSegmentLength = track.totalLength / (samples.length - 1);
  const skipCount = Math.max(1, Math.floor(segmentLength / avgSegmentLength));

  for (let i = 0; i < samples.length - skipCount; i += skipCount) {
    const sample = samples[i];

    // Left wall
    const leftWall = createWallBox(sample, offset, height, segmentLength, true);
    world.addBody(leftWall);
    bodies.push(leftWall);

    // Right wall
    const rightWall = createWallBox(sample, offset, height, segmentLength, false);
    world.addBody(rightWall);
    bodies.push(rightWall);
  }

  console.log(`🚧 Created ${bodies.length} guardrail segments`);

  return bodies;
}

function createWallBox(
  sample: TrackSample,
  offset: number,
  height: number,
  length: number,
  isLeft: boolean
): CANNON.Body {
  const halfExtents = new CANNON.Vec3(
    0.5,           // Thin wall (1m thick)
    height * 0.5,  // Wall height
    length * 0.5   // Segment length
  );

  const shape = new CANNON.Box(halfExtents);

  // Flip normal to point up (same as track boxes)
  const upNormal = sample.normal.clone().multiplyScalar(-1);
  const orientation = buildOrientationQuaternion(
    sample.tangent,
    upNormal,
    sample.binormal
  );

  // Offset position along binormal (left or right)
  const offsetDirection = isLeft ? 1 : -1;
  const position = new THREE.Vector3()
    .copy(sample.position)
    .addScaledVector(sample.binormal, offsetDirection * offset);

  return new CANNON.Body({
    mass: 0,
    shape,
    position: new CANNON.Vec3(position.x, position.y + height * 0.5, position.z),
    quaternion: orientation,
    type: CANNON.Body.STATIC,
  });
}
