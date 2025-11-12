import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { TrackSurface } from './track';

/**
 * SMOOTH TRACK RAYCASTING
 *
 * Clones CANNON's RaycastVehicle.castRay() but replaces world.rayTest()
 * with a smooth track surface intersection. This keeps ALL of CANNON's
 * suspension math intact while eliminating stepping.
 */

// Feature flag
export let useSmoothRaycasts = true;

// Reusable raycaster
const raycaster = new THREE.Raycaster();

// Debug counters - set to high number to disable logs
let debugCounter = 1000;
let debugClampCounter = 1000;

// TEMPORAL NORMAL SMOOTHING: Store normal history per wheel to smooth over time
// This eliminates suspension jitter by averaging normals across multiple frames
const wheelNormalHistory: Map<number, THREE.Vector3[]> = new Map();
const NORMAL_HISTORY_FRAMES = 8; // Smooth over 8 frames (~133ms at 60fps)

// Reset debug counters on module reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    debugCounter = 0;
    debugClampCounter = 0;
  });
}

/**
 * Test ray against smooth track surface.
 * Returns true and populates raycastResult if hit, false otherwise.
 */
function testRayAgainstTrack(
  track: TrackSurface,
  source: CANNON.Vec3,
  target: CANNON.Vec3,
  raycastResult: any // CANNON.RaycastResult
): boolean {
  // CRITICAL: Update mesh world matrix before raycasting
  track.mesh.updateMatrixWorld(true);

  // Convert CANNON vectors to THREE
  const rayOrigin = new THREE.Vector3(source.x, source.y, source.z);
  const rayTarget = new THREE.Vector3(target.x, target.y, target.z);
  const rayDirection = new THREE.Vector3().subVectors(rayTarget, rayOrigin);
  const rayLength = rayDirection.length();
  rayDirection.normalize();

  // Setup raycaster - extend far distance to ensure we can reach ground
  raycaster.set(rayOrigin, rayDirection);
  raycaster.far = rayLength * 3.0; // 3x normal length to debug reach issues

  // Raycast against track mesh
  const intersects = raycaster.intersectObject(track.mesh, false);

  // Debug: Log first few raycasts with detailed info
  if (debugCounter < 10) {
    const meshInfo = track.mesh.geometry ? `faces=${track.mesh.geometry.index ? track.mesh.geometry.index.count / 3 : 'no index'}` : 'no geometry';
    console.log(`🔍 Raycast #${debugCounter}: origin=(${rayOrigin.x.toFixed(1)}, ${rayOrigin.y.toFixed(1)}, ${rayOrigin.z.toFixed(1)}), dir=(${rayDirection.x.toFixed(2)}, ${rayDirection.y.toFixed(2)}, ${rayDirection.z.toFixed(2)}), len=${rayLength.toFixed(2)}, far=${(rayLength * 3.0).toFixed(2)}, hits=${intersects.length}, ${meshInfo}`);
    if (debugCounter === 0) {
      console.log(`📦 Mesh info: visible=${track.mesh.visible}, matrixWorldNeedsUpdate=${track.mesh.matrixWorldNeedsUpdate}, layers=${track.mesh.layers.mask}`);
    }
    debugCounter++;
  }

  if (intersects.length === 0) {
    return false; // No hit
  }

  // Take closest hit
  const hit = intersects[0];

  // Debug: Log hit details
  if (debugCounter < 15) {
    console.log(`   ✅ HIT at distance=${hit.distance.toFixed(3)}, point=(${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}, ${hit.point.z.toFixed(1)}), normal=(${hit.face!.normal.x.toFixed(2)}, ${hit.face!.normal.y.toFixed(2)}, ${hit.face!.normal.z.toFixed(2)})`);
  }

  // Populate raycastResult exactly as CANNON does
  raycastResult.hitPointWorld.set(hit.point.x, hit.point.y, hit.point.z);

  // Transform normal to world space
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(track.mesh.matrixWorld);
  const worldNormal = hit.face!.normal.clone().applyMatrix3(normalMatrix).normalize();

  // CRITICAL: Ensure normal points toward ray origin (up from ground)
  // If normal points away from ray origin, flip it
  if (worldNormal.dot(rayDirection) > 0) {
    worldNormal.multiplyScalar(-1);
  }

  raycastResult.hitNormalWorld.set(worldNormal.x, worldNormal.y, worldNormal.z);
  raycastResult.distance = hit.distance;

  // CRITICAL: CANNON needs a body object with velocity methods for friction calculations
  // Create a fake static body that implements the required interface

  // Zero matrix for static body (no rotation, infinite inertia)
  const zeroMat = new CANNON.Mat3();
  zeroMat.elements = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Always create fresh body with current hit point position
  // IMPORTANT: Always return NEW Vec3 instances to prevent CANNON from modifying our references
  raycastResult.body = {
    type: 0, // STATIC
    velocity: new CANNON.Vec3(0, 0, 0),
    angularVelocity: new CANNON.Vec3(0, 0, 0),
    position: new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z), // Position at hit point for friction calculations
    invInertiaWorld: zeroMat, // Inverse inertia tensor (zero for static body)
    invMass: 0, // Infinite mass (static body)
    getVelocityAtWorldPoint: function() { return new CANNON.Vec3(0, 0, 0); }, // Always return fresh zero vector
    applyImpulse: function(_impulse: any, _relativePoint: any) { /* Static body - no impulse applied */ },
    applyForce: function(_force: any, _relativePoint: any) { /* Static body - no force applied */ }
  };

  return true;
}

/**
 * Clone of CANNON's RaycastVehicle.castRay() with smooth track intersection.
 *
 * This function is copied from cannon-es and modified ONLY to replace
 * world.rayTest() with testRayAgainstTrack(). All suspension math is identical.
 */
export function castRaySmooth(
  vehicle: any, // CANNON.RaycastVehicle
  wheel: any,   // CANNON.WheelInfo
  track: TrackSurface
): number {
  // Get wheel index for tracking history
  const wheelIndex = vehicle.wheelInfos.indexOf(wheel);
  // Update wheel transform (same as CANNON)
  vehicle.updateWheelTransformWorld(wheel);

  const chassisBody = vehicle.chassisBody;
  let depth = -1;

  // Calculate ray - EXTENDED: Look 2x further to handle steep slopes
  // Default: suspensionRestLength + radius (0.3 + 0.35 = 0.65m)
  // Extended: 2x length (1.3m) to catch ground on steep descents
  const raylen = (wheel.suspensionRestLength + wheel.radius) * 2.0;
  const rayvector = new CANNON.Vec3();
  wheel.directionWorld.scale(raylen, rayvector);

  const source = wheel.chassisConnectionPointWorld;
  const target = new CANNON.Vec3();
  source.vadd(rayvector, target);

  const raycastResult = wheel.raycastResult;
  raycastResult.reset();

  // Turn off chassis collision temporarily (same as CANNON)
  const oldState = chassisBody.collisionResponse;
  chassisBody.collisionResponse = false;

  // **ONLY DIFFERENCE**: Use smooth track raycast instead of world.rayTest()
  const hasHit = useSmoothRaycasts
    ? testRayAgainstTrack(track, source, target, raycastResult)
    : false; // Fallback handled by caller

  chassisBody.collisionResponse = oldState;

  // Rest is identical to CANNON
  // NOTE: Set groundObject to 1 (truthy) so CANNON applies driving forces
  // Setting to 0 (falsy) would cause CANNON to skip force application
  wheel.raycastResult.groundObject = hasHit ? 1 : 0;

  if (hasHit) {
    depth = raycastResult.distance;

    // TEMPORAL NORMAL SMOOTHING: Average normal with previous frames
    // This smooths suspension input, eliminating jitter from frame-to-frame normal changes
    const rawNormal = new THREE.Vector3(
      raycastResult.hitNormalWorld.x,
      raycastResult.hitNormalWorld.y,
      raycastResult.hitNormalWorld.z
    );

    // Get or create history for this wheel
    if (!wheelNormalHistory.has(wheelIndex)) {
      wheelNormalHistory.set(wheelIndex, []);
    }
    const history = wheelNormalHistory.get(wheelIndex)!;

    // Add current normal to history
    history.push(rawNormal.clone());
    if (history.length > NORMAL_HISTORY_FRAMES) {
      history.shift(); // Remove oldest
    }

    // Average normals over time
    const smoothedNormal = new THREE.Vector3();
    history.forEach(n => smoothedNormal.add(n));
    smoothedNormal.divideScalar(history.length).normalize();

    // Use smoothed normal for suspension calculations
    wheel.raycastResult.hitNormalWorld.set(smoothedNormal.x, smoothedNormal.y, smoothedNormal.z);
    wheel.isInContact = true;

    // Debug: Log that we're setting contact
    if (debugCounter < 12) {
      console.log(`   ✅ Setting wheel.isInContact=true, groundObject=${wheel.raycastResult.groundObject}, normal smoothed over ${history.length} frames`);
    }

    const hitDistance = raycastResult.distance;
    wheel.suspensionLength = hitDistance - wheel.radius;

    // Clamp suspension travel (same as CANNON)
    const minSuspensionLength = wheel.suspensionRestLength - wheel.maxSuspensionTravel;
    const maxSuspensionLength = wheel.suspensionRestLength + wheel.maxSuspensionTravel;

    // Debug suspension clamping
    if (debugClampCounter < 5) {
      console.log(`   🔧 Suspension: hitDist=${hitDistance.toFixed(3)}, suspLen=${wheel.suspensionLength.toFixed(3)}, range=[${minSuspensionLength.toFixed(2)}, ${maxSuspensionLength.toFixed(2)}]`);
      debugClampCounter++;
    }

    if (wheel.suspensionLength < minSuspensionLength) {
      wheel.suspensionLength = minSuspensionLength;
      if (debugClampCounter < 6) console.log(`   ⚠️  Clamped to MIN`);
    }

    if (wheel.suspensionLength > maxSuspensionLength) {
      wheel.suspensionLength = maxSuspensionLength;
      raycastResult.reset();
      if (debugClampCounter < 6) console.log(`   ❌ RESET - suspension beyond max travel!`);
    }

    // Calculate suspension velocity (same as CANNON)
    const denominator = wheel.raycastResult.hitNormalWorld.dot(wheel.directionWorld);
    const chassis_velocity_at_contactPoint = new CANNON.Vec3();
    chassisBody.getVelocityAtWorldPoint(
      wheel.raycastResult.hitPointWorld,
      chassis_velocity_at_contactPoint
    );
    const projVel = wheel.raycastResult.hitNormalWorld.dot(chassis_velocity_at_contactPoint);

    if (denominator >= -0.1) {
      wheel.suspensionRelativeVelocity = 0;
      wheel.clippedInvContactDotSuspension = 1 / 0.1;
    } else {
      const inv = -1 / denominator;
      wheel.suspensionRelativeVelocity = projVel * inv;
      wheel.clippedInvContactDotSuspension = inv;
    }
  } else {
    // No hit - rest position (same as CANNON)
    wheel.suspensionLength = wheel.suspensionRestLength + 0 * wheel.maxSuspensionTravel;
    wheel.suspensionRelativeVelocity = 0.0;
    wheel.directionWorld.scale(-1, wheel.raycastResult.hitNormalWorld);
    wheel.clippedInvContactDotSuspension = 1.0;
  }

  return depth;
}
