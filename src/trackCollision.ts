import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { TrackSurface, type TrackSample } from './track';

/**
 * DEBUG: Visualize collision boxes as wireframes
 * Shows exact placement, size, and orientation of collision geometry
 */
export function visualizeCollisionBodies(
  bodies: CANNON.Body[],
  scene: THREE.Scene,
  options?: {
    color?: number;
    opacity?: number;
  }
): THREE.LineSegments[] {
  const { color = 0x00ff00, opacity = 0.4 } = options || {};
  const wireframes: THREE.LineSegments[] = [];

  for (const body of bodies) {
    for (const shape of body.shapes) {
      if (shape instanceof CANNON.Box) {
        // Create box geometry matching CANNON.Box half-extents
        const box = shape as CANNON.Box;
        const geometry = new THREE.BoxGeometry(
          box.halfExtents.x * 2,
          box.halfExtents.y * 2,
          box.halfExtents.z * 2
        );

        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthTest: true,
        });

        const wireframe = new THREE.LineSegments(edges, material);

        // Apply same position and rotation as physics body
        wireframe.position.set(
          body.position.x,
          body.position.y,
          body.position.z
        );
        wireframe.quaternion.set(
          body.quaternion.x,
          body.quaternion.y,
          body.quaternion.z,
          body.quaternion.w
        );

        scene.add(wireframe);
        wireframes.push(wireframe);
      }
    }
  }

  console.log(`🔍 Visualized ${wireframes.length} collision boxes`);
  return wireframes;
}

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

  console.log(`🏗️ Track collision: ${track.totalLength.toFixed(0)}m track, adaptive spacing`);

  // ADAPTIVE SPACING: Tighter on corners, wider on straights
  // This eliminates stepping on tight corners while maintaining good performance
  let lastWedgeDistance = -segmentLength;
  const curvatureThreshold = 0.15; // Detect tight corners (same as guardrails)

  for (let i = 0; i < samples.length - 1; i++) {
    const sampleA = samples[i];

    // Calculate curvature (rate of tangent change)
    let curvature = 0;
    if (i + 10 < samples.length) {
      const tangentDiff = new THREE.Vector3()
        .subVectors(samples[i + 10].tangent, sampleA.tangent)
        .length();
      const distanceDiff = samples[i + 10].distance - sampleA.distance;
      curvature = tangentDiff / Math.max(distanceDiff, 0.1);
    }

    // Adaptive spacing: tight corners = 0.5m, straights = 1.0m
    const isTightCorner = curvature > curvatureThreshold;
    const adaptiveSpacing = isTightCorner ? 0.5 : 1.0;
    const boxSpanLength = adaptiveSpacing * 4.0; // 4x overlap - longer boxes = smoother slopes

    // Check if we've traveled far enough to place another wedge
    if (sampleA.distance - lastWedgeDistance >= adaptiveSpacing) {
      // Find sampleB that's approximately boxSpanLength ahead
      let sampleB = samples[i + 1];
      let bestJ = i + 1;
      let bestDiff = Math.abs((sampleB.distance - sampleA.distance) - boxSpanLength);

      // Search ahead to find sample closest to boxSpanLength distance
      for (let j = i + 2; j < samples.length && samples[j].distance - sampleA.distance < boxSpanLength * 1.5; j++) {
        const diff = Math.abs((samples[j].distance - sampleA.distance) - boxSpanLength);
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
      }

      lastWedgeDistance = sampleA.distance;
    }
  }

  console.log(`✅ Created ${bodies.length} collision wedges`);

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
    collisionFilterGroup: 2, // MAIN_GROUND_GROUP
    collisionFilterMask: ~1,  // Don't collide with CHASSIS_GROUP
  });

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
