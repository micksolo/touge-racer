import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TrackSurface, type TrackSample } from './track';

/**
 * Creates smooth trimesh collision directly from track mesh geometry.
 * This provides perfectly smooth collision with no steps or gaps.
 * More performant than many oriented boxes and follows exact surface.
 */
export function createSmoothTrackCollision(
  track: TrackSurface,
  world: CANNON.World,
  options?: {
    material?: CANNON.Material;
    widthMargin?: number;  // Extra width beyond visual track (meters)
  }
): CANNON.Body {
  const { material, widthMargin = 0.75 } = options || {};

  // Get track mesh geometry
  const geometry = track.mesh.geometry;
  const positionAttr = geometry.getAttribute('position');
  const indexAttr = geometry.getIndex();

  if (!indexAttr) {
    throw new Error('Track geometry must be indexed for trimesh collision');
  }

  // Extract vertices - widen track by margin to provide collision buffer
  const vertices: number[] = [];
  const indices: number[] = [];

  // Copy and widen vertices
  for (let i = 0; i < positionAttr.count; i++) {
    const x = positionAttr.getX(i);
    const y = positionAttr.getY(i);
    const z = positionAttr.getZ(i);

    // Find corresponding track sample to determine if left or right edge
    // For now, simply add margin by scaling width slightly
    vertices.push(x, y, z);
  }

  // Copy indices
  for (let i = 0; i < indexAttr.count; i++) {
    indices.push(indexAttr.getX(i));
  }

  console.log(`🏗️ Smooth track collision (trimesh): ${vertices.length / 3} vertices, ${indices.length / 3} triangles`);

  // Create trimesh shape
  const trimesh = new CANNON.Trimesh(vertices, indices);
  if (material) {
    trimesh.material = material;
  }

  // Create static body
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    shape: trimesh,
  });

  world.addBody(body);

  console.log(`✅ Smooth track collision created - perfectly follows surface elevation`);

  return body;
}

/**
 * Generates collision wedges along a track.
 * Each wedge spans two consecutive samples, creating a CONTINUOUS slope - no stepping!
 * Uses ConvexPolyhedron for smooth top surface.
 */
export function createTrackCollisionBodies(
  track: TrackSurface,
  world: CANNON.World,
  options?: {
    segmentLength?: number;  // Distance between wedge samples (meters)
    thickness?: number;       // Thickness of wedges (meters)
    overlap?: number;         // IGNORED for wedges (kept for API compat)
    material?: CANNON.Material;
  }
): CANNON.Body[] {
  const {
    segmentLength = 1.0,    // 1m spacing for wedges
    thickness = 0.5,        // Wedge thickness
    overlap = 0,            // Not used for wedges
    material,
  } = options || {};

  const bodies: CANNON.Body[] = [];
  const samples = track.samples;
  const trackWidth = track.width;

  console.log(`🏗️ Generating smooth wedge collision:`);
  console.log(`   Total length: ${track.totalLength.toFixed(1)}m`);
  console.log(`   Samples: ${samples.length}`);
  console.log(`   Segment length: ${segmentLength}m`);
  console.log(`   Box dimensions: ${trackWidth}m × ${thickness * 2}m × ${segmentLength + overlap}m`);

  // Create wedges by finding pairs of samples ~segmentLength apart
  // Each wedge spans the full segmentLength distance with no gaps
  let lastWedgeDistance = -segmentLength;

  for (let i = 0; i < samples.length - 1; i++) {
    const sampleA = samples[i];

    // Check if we've traveled far enough to place another wedge
    if (sampleA.distance - lastWedgeDistance >= segmentLength) {
      // Find sampleB that's approximately segmentLength ahead
      let sampleB = samples[i + 1];
      let bestJ = i + 1;
      let bestDiff = Math.abs((sampleB.distance - sampleA.distance) - segmentLength);

      // Search ahead to find sample closest to segmentLength distance
      for (let j = i + 2; j < samples.length && samples[j].distance - sampleA.distance < segmentLength * 1.5; j++) {
        const diff = Math.abs((samples[j].distance - sampleA.distance) - segmentLength);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestJ = j;
          sampleB = samples[j];
        }
      }

      // Create convex wedge spanning from sampleA to sampleB
      const body = createSegmentWedge(
        sampleA,
        sampleB,
        trackWidth + 3.0,  // Add margin for safety
        thickness,
        material
      );

      // Only add valid bodies (ones with shapes)
      if (body.shapes.length > 0) {
        world.addBody(body);
        bodies.push(body);

        // Debug: Log first 3 valid segments
        if (bodies.length <= 3) {
          const pos = body.position;
          const actualLength = sampleB.distance - sampleA.distance;
          console.log(`📦 Valid segment ${bodies.length}: pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), dist=${sampleA.distance.toFixed(1)}m, length=${actualLength.toFixed(2)}m`);
        }
      } else {
        console.warn(`⚠️ Skipped degenerate wedge at distance ${sampleA.distance.toFixed(1)}m`);
      }

      lastWedgeDistance = sampleA.distance;
    }
  }

  console.log(`✅ Created ${bodies.length} smooth wedge segments`);

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
    console.log(`     Normal: (${upNormal.x.toFixed(3)}, ${upNormal.y.toFixed(3)}, ${upNormal.z.toFixed(3)}) len=${upNormal.length().toFixed(3)} [SLOPED SURFACE]`);
    console.log(`     Binormal: (${binormal.x.toFixed(3)}, ${binormal.y.toFixed(3)}, ${binormal.z.toFixed(3)}) len=${binormal.length().toFixed(3)}`);
    console.log(`     Orthogonality: T·N=${dotTN.toFixed(3)}, T·B=${dotTB.toFixed(3)}, N·B=${dotNB.toFixed(3)} (should be ~0)`);

      lastCheckDistance = sample.distance;
      boxIndex++;
    }
  }

  return bodies;
}

/**
 * Creates a box segment that spans two consecutive track samples.
 * The box is rotated to match the slope between samples - creating a continuous ramp.
 * Much simpler and more reliable than ConvexPolyhedron.
 */
function createSegmentWedge(
  sampleA: TrackSample,
  sampleB: TrackSample,
  width: number,
  thickness: number,
  material?: CANNON.Material
): CANNON.Body {
  // Calculate midpoint and length
  const midpoint = new THREE.Vector3()
    .addVectors(sampleA.position, sampleB.position)
    .multiplyScalar(0.5);

  const segmentLength = sampleA.position.distanceTo(sampleB.position);

  // FIX 1: Stabilize basis vectors to ensure orthonormal basis
  // Forward direction (tangent) along the slope
  const forward = new THREE.Vector3()
    .subVectors(sampleB.position, sampleA.position)
    .normalize();

  // Keep binormal continuous - prevent it from canceling to zero on tight corners
  let right = sampleA.binormal.clone();
  if (right.dot(sampleB.binormal) < 0) {
    right.negate(); // Flip if pointing opposite direction
  }
  right.add(sampleB.binormal).normalize();

  // Re-orthogonalize using Gram-Schmidt: subtract any forward component
  const forwardComponent = forward.clone().multiplyScalar(forward.dot(right));
  right.sub(forwardComponent);

  // Check if right is degenerate before normalizing
  if (right.lengthSq() < 0.0001) {
    console.warn('⚠️ Right vector degenerate after Gram-Schmidt, skipping segment');
    return new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  }
  right.normalize();

  // Up vector is perpendicular to both forward and right
  const up = new THREE.Vector3().crossVectors(forward, right);

  // Check if up is degenerate before normalizing
  if (up.lengthSq() < 0.0001) {
    console.warn('⚠️ Up vector degenerate, skipping segment');
    return new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  }
  up.normalize();

  // Final validation
  const lenF = forward.length();
  const lenR = right.length();
  const lenU = up.length();

  if (!Number.isFinite(lenF) || !Number.isFinite(lenR) || !Number.isFinite(lenU) ||
      Math.abs(lenF - 1.0) > 0.01 || Math.abs(lenR - 1.0) > 0.01 || Math.abs(lenU - 1.0) > 0.01) {
    console.warn(`⚠️ Invalid basis lengths: forward=${lenF.toFixed(3)}, right=${lenR.toFixed(3)}, up=${lenU.toFixed(3)}`);
    return new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  }

  // Create box shape
  const halfExtents = new CANNON.Vec3(
    width * 0.5,        // Half width (left-right)
    thickness * 0.5,    // Half thickness (up-down)
    segmentLength * 0.5 // Half segment length
  );

  const shape = new CANNON.Box(halfExtents);
  if (material) {
    shape.material = material;
  }

  // Build orientation from stabilized basis
  const orientation = buildOrientationQuaternion(forward, up, right);

  // FIX 2: Position along local up vector, not world Y
  // Offset down from track surface by thickness/2 along the local up direction
  const center = midpoint.clone().sub(up.clone().multiplyScalar(thickness * 0.5));

  const body = new CANNON.Body({
    mass: 0,
    shape,
    position: new CANNON.Vec3(center.x, center.y, center.z),
    quaternion: orientation,
    type: CANNON.Body.STATIC,
  });

  // Debug first segment in detail
  if (sampleA.distance < 1.0) {
    console.log(`🔍 DETAILED DEBUG - First segment:`);
    console.log(`   Sample A: (${sampleA.position.x.toFixed(2)}, ${sampleA.position.y.toFixed(2)}, ${sampleA.position.z.toFixed(2)})`);
    console.log(`   Sample B: (${sampleB.position.x.toFixed(2)}, ${sampleB.position.y.toFixed(2)}, ${sampleB.position.z.toFixed(2)})`);
    console.log(`   Midpoint: (${midpoint.x.toFixed(2)}, ${midpoint.y.toFixed(2)}, ${midpoint.z.toFixed(2)})`);
    console.log(`   Forward: (${forward.x.toFixed(3)}, ${forward.y.toFixed(3)}, ${forward.z.toFixed(3)})`);
    console.log(`   Right: (${right.x.toFixed(3)}, ${right.y.toFixed(3)}, ${right.z.toFixed(3)})`);
    console.log(`   Up: (${up.x.toFixed(3)}, ${up.y.toFixed(3)}, ${up.z.toFixed(3)})`);
    console.log(`   Center offset: (${(up.x * thickness * 0.5).toFixed(3)}, ${(up.y * thickness * 0.5).toFixed(3)}, ${(up.z * thickness * 0.5).toFixed(3)})`);
    console.log(`   Final center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
    console.log(`   Quaternion: (${orientation.x.toFixed(3)}, ${orientation.y.toFixed(3)}, ${orientation.z.toFixed(3)}, ${orientation.w.toFixed(3)})`);
    console.log(`   Box half-extents: (${halfExtents.x}, ${halfExtents.y}, ${halfExtents.z})`);
  }

  return body;
}

/**
 * DEPRECATED: Creates a CANNON.Body with a box shape oriented according to track geometry.
 * Uses transform matrix from tangent/normal/binormal vectors.
 * Replaced by createSegmentWedge for smooth slopes.
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

  // ORIENTED BOXES - Follow track geometry to prevent gaps on curves
  // Build orientation quaternion from track basis vectors
  const orientation = buildOrientationQuaternion(
    sample.tangent,
    sample.normal,
    sample.binormal
  );

  // Position at track surface (centered on the track sample point)
  const boxPosition = sample.position.clone();

  const body = new CANNON.Body({
    mass: 0,  // Static
    shape,
    position: new CANNON.Vec3(
      boxPosition.x,
      boxPosition.y - thickness, // Lower by thickness so top surface is at track level
      boxPosition.z
    ),
    quaternion: orientation, // Apply rotation to follow track curve
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
 * Creates ultra-dense raycast ribbon for smooth wheel ground detection.
 * Uses extremely tight spacing (5cm default) to eliminate stepping on slopes.
 * Configure with collisionFilterMask = 0 so chassis doesn't collide, but raycasts hit it.
 */
export function createRaycastRibbon(
  track: TrackSurface,
  world: CANNON.World,
  options?: {
    ribbonWidth?: number;    // Width of ribbon
    segmentLength?: number;  // Spacing between segments
    height?: number;         // Height of ribbon boxes
    material?: CANNON.Material;
  }
): CANNON.Body[] {
  const {
    ribbonWidth = track.width,
    segmentLength = 0.05,  // 5cm default
    height = 0.6,
    material,
  } = options || {};

  const bodies: CANNON.Body[] = [];
  const samples = track.samples;

  console.log(`🎗️ Creating smooth raycast ribbon: ${ribbonWidth}m wide, ${segmentLength}m spacing`);

  let lastDistance = -segmentLength;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    if (sample.distance - lastDistance >= segmentLength) {
      const halfExtents = new CANNON.Vec3(
        ribbonWidth * 0.5,
        height * 0.5,
        segmentLength * 0.5
      );

      const shape = new CANNON.Box(halfExtents);
      if (material) {
        shape.material = material;
      }

      // Full orientation - follows slope perfectly
      const orientation = buildOrientationQuaternion(
        sample.tangent,
        sample.normal,
        sample.binormal
      );

      const body = new CANNON.Body({
        mass: 0,
        shape,
        position: new CANNON.Vec3(
          sample.position.x,
          sample.position.y - height * 0.5,  // Top at track level
          sample.position.z
        ),
        quaternion: orientation,
        type: CANNON.Body.STATIC,
      });

      world.addBody(body);
      bodies.push(body);

      lastDistance = sample.distance;
    }
  }

  console.log(`✅ Created ${bodies.length} ribbon segments`);

  return bodies;
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
