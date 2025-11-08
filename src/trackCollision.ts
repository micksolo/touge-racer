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

  console.log(`🏗️ Generating track collision:`);
  console.log(`   Total length: ${track.totalLength.toFixed(1)}m`);
  console.log(`   Samples: ${samples.length}`);
  console.log(`   Segment length: ${segmentLength}m`);
  console.log(`   Box dimensions: ${trackWidth}m × ${thickness * 2}m × ${segmentLength + overlap}m`);

  // Create a box every 'segmentLength' meters along the track
  // Use actual distance along curve, not sample count
  let lastBoxDistance = -segmentLength; // Start before 0 so first box is at 0

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // Check if we've traveled far enough to place another box
    if (sample.distance - lastBoxDistance >= segmentLength) {
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

      lastBoxDistance = sample.distance;
    }
  }

  console.log(`✅ Created ${bodies.length} collision boxes`);

  // Verify and log sample transforms (first 3 boxes)
  console.log(`🔍 Sample transforms and basis vectors (first 3):`);
  let boxIndex = 0;
  let lastCheckDistance = -segmentLength;

  for (let i = 0; i < samples.length && boxIndex < Math.min(3, bodies.length); i++) {
    const sample = samples[i];

    if (sample.distance - lastCheckDistance >= segmentLength) {
      const pos = bodies[boxIndex].position;

    // Verify basis is orthonormal (normal now points up, no flip needed)
    const tangent = sample.tangent;
    const upNormal = sample.normal.clone();
    const binormal = sample.binormal;

    const dotTN = tangent.dot(upNormal);
    const dotTB = tangent.dot(binormal);
    const dotNB = upNormal.dot(binormal);

    console.log(`   Box ${boxIndex}:`);
    console.log(`     Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    console.log(`     Distance: ${sample.distance.toFixed(1)}m`);
    console.log(`     Tangent:  (${tangent.x.toFixed(3)}, ${tangent.y.toFixed(3)}, ${tangent.z.toFixed(3)}) len=${tangent.length().toFixed(3)}`);
    console.log(`     Up Normal: (${upNormal.x.toFixed(3)}, ${upNormal.y.toFixed(3)}, ${upNormal.z.toFixed(3)}) len=${upNormal.length().toFixed(3)} [FLAT ROAD]`);
    console.log(`     Binormal: (${binormal.x.toFixed(3)}, ${binormal.y.toFixed(3)}, ${binormal.z.toFixed(3)}) len=${binormal.length().toFixed(3)}`);
    console.log(`     Orthogonality: T·N=${dotTN.toFixed(3)}, T·B=${dotTB.toFixed(3)}, N·B=${dotNB.toFixed(3)} (should be ~0)`);

      lastCheckDistance = sample.distance;
      boxIndex++;
    }
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
  // Make boxes wider than visual track to ensure coverage in corners
  const widthMargin = 1.5; // Add 3m total width (1.5m per side)
  const halfExtents = new CANNON.Vec3(
    (width + widthMargin) * 0.5,   // Half track width + margin (left-right)
    thickness,                      // Half thickness (up-down)
    length * 0.5                    // Half segment length (forward-back)
  );

  const shape = new CANNON.Box(halfExtents);

  if (material) {
    shape.material = material;
  }

  // IMPORTANT: Use axis-aligned boxes (no rotation) for reliable raycast collision
  // RaycastVehicle works best with flat, unrotated collision boxes
  // Position the box so its TOP surface is at the track surface
  // Force all boxes to same Y level for perfectly smooth surface
  const trackSurfaceY = 60.0; // Hardcoded to match track geometry
  const boxPosition = new THREE.Vector3(
    sample.position.x,
    trackSurfaceY - thickness, // All boxes at exact same Y for smooth surface
    sample.position.z
  );

  const body = new CANNON.Body({
    mass: 0,  // Static
    shape,
    position: new CANNON.Vec3(
      boxPosition.x,
      boxPosition.y,
      boxPosition.z
    ),
    // No quaternion - keep boxes axis-aligned for raycast compatibility
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

  // Place walls every 'segmentLength' meters using actual distance
  let lastWallDistance = -segmentLength;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    if (sample.distance - lastWallDistance >= segmentLength) {
      // Left wall
      const leftWall = createWallBox(sample, offset, height, segmentLength, true);
      world.addBody(leftWall);
      bodies.push(leftWall);

      // Right wall
      const rightWall = createWallBox(sample, offset, height, segmentLength, false);
      world.addBody(rightWall);
      bodies.push(rightWall);

      lastWallDistance = sample.distance;
    }
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

  // Use normal directly (already points up due to flat road enforcement)
  const upNormal = sample.normal.clone();
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
