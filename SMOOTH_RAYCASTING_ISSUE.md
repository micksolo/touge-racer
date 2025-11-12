# Smooth Track Raycasting - Stepping/Warping Issue

## Problem Summary
We have a **touge (mountain pass) racing game** using **CANNON-ES physics** with **RaycastVehicle**. We successfully implemented **smooth track raycasting** (replacing discrete collision boxes with THREE.js mesh raycasting), which works correctly for physics (4/4 wheels detect ground contact). However, we're experiencing **visible stepping/jitter** when the car drives through **tight corners**, despite the raycasting hitting smooth geometry.

## Current Implementation

### What Works ✅
1. **Smooth raycasting is functional**: Wheels raycast against THREE.js track mesh instead of discrete physics bodies
2. **Wheel contact detection works**: All 4 wheels properly detect ground (telemetry shows 4/4)
3. **Physics calculations are correct**: Suspension forces, velocities, and forces all compute properly
4. **Visual interpolation added**: Car position lerps toward physics position (0.8 factor)
5. **Track geometry improvements**: Added binormal smoothing (70% lerp with previous segment)

### What Doesn't Work ❌
1. **Visible stepping on tight corners**: Car visibly "steps" up and down when going through curves
2. **Track geometry warping**: Inner part of tight curves shows visible warping/twisting (see screenshot)
3. **Some straight sections have jitter**: Minor vertical bouncing even on supposedly flat sections

## Technical Details

### Physics Setup
- **Engine**: CANNON-ES v0.20.0
- **Vehicle**: RaycastVehicle with 4 wheels
- **Suspension**:
  - Stiffness: 100
  - Damping compression: 25
  - Damping relaxation: 30
  - Rest length: 0.3m
  - Max travel: 0.15m

### Smooth Raycasting Implementation
```typescript
// Our custom castRaySmooth() replaces CANNON's castRay()
// It clones CANNON's suspension math exactly, only replacing:
//   world.rayTest() → raycaster.intersectObject(track.mesh)

export function castRaySmooth(vehicle, wheel, track) {
  // Update wheel transform (same as CANNON)
  vehicle.updateWheelTransformWorld(wheel);

  // Calculate ray (same as CANNON)
  const raylen = wheel.suspensionRestLength + wheel.radius;

  // **ONLY DIFFERENCE**: Use THREE.Raycaster instead of physics raycast
  const raycaster = new THREE.Raycaster();
  raycaster.set(rayOrigin, rayDirection);
  const intersects = raycaster.intersectObject(track.mesh, false);

  if (intersects.length > 0) {
    const hit = intersects[0];

    // Populate raycastResult with hit data
    raycastResult.hitPointWorld.set(hit.point.x, hit.point.y, hit.point.z);

    // Transform normal to world space
    const worldNormal = hit.face.normal.clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    // Create fake static body for CANNON's friction solver
    raycastResult.body = {
      type: 0, // STATIC
      velocity: new CANNON.Vec3(0, 0, 0),
      angularVelocity: new CANNON.Vec3(0, 0, 0),
      position: new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z),
      invInertiaWorld: zeroMat,
      invMass: 0,
      getVelocityAtWorldPoint: () => new CANNON.Vec3(0, 0, 0),
      applyImpulse: () => {},
      applyForce: () => {}
    };

    wheel.isInContact = true;
    // ... rest of CANNON's suspension math unchanged
  }
}
```

### Track Geometry Generation
```typescript
// Track is generated from Catmull-Rom spline with Frenet frames
for (let i = 0; i <= segments; i++) {
  const point = curve.getPointAt(tNorm);
  const tangent = frames.tangents[i].clone().normalize();

  // Binormal points horizontally (perpendicular to tangent + world up)
  let binormal = new THREE.Vector3().crossVectors(worldUp, tangent);
  binormal.normalize();

  // SMOOTH binormal with previous segment (added to reduce warping)
  if (i > 0 && samples.length > 0) {
    const prevBinormal = samples[samples.length - 1].binormal;
    binormal.lerp(prevBinormal, 0.7).normalize(); // 70% previous, 30% current
  }

  // Create left/right vertices
  const left = point.clone().addScaledVector(binormal, width * 0.5);
  const right = point.clone().addScaledVector(binormal, -width * 0.5);

  positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
}
```

## Observed Issues

### 1. Stepping on Tight Corners
- **Symptom**: Car chassis visibly "steps" up and down (2-5cm jumps) when navigating curves
- **Frequency**: More pronounced on tighter curves (radius < 20m)
- **Timing**: Appears to be frame-by-frame, not gradual oscillation

### 2. Track Geometry Warping
- **Symptom**: Track surface has visible twisting/warping on inner part of curves
- **Visual**: Instead of smooth flat banking, the inner edge appears wavy/twisted
- **Impact**: Even though raycasting hits this warped geometry smoothly, the visual warping suggests the underlying mesh is non-planar

### 3. Inconsistent on Different Curves
- Some curves are perfectly smooth
- Others have noticeable stepping
- No clear pattern based on curve radius, speed, or banking

## What We've Tried

1. ❌ **Increased suspension damping (25→50, 30→60)**: Made it WORSE - car bounced even on straights
2. ✅ **Added visual interpolation (lerp 0.8)**: Helped slightly but didn't eliminate stepping
3. ✅ **Added binormal smoothing (70% prev)**: Reduced warping but didn't eliminate stepping
4. ✅ **Fixed camera NaN bug**: Solved visibility issues but didn't affect stepping
5. ❌ **Adjusted suspension stiffness**: No significant impact

## Questions for Review

### Primary Question
**How do arcade racing games (like Mario Kart, Ridge Racer, etc.) handle smooth track surfaces with physics-based vehicles?**

Specifically:
1. Do they use raycasting at all, or do they use a different ground detection method?
2. How do they ensure perfectly smooth surfaces on curves?
3. Do they use procedural spline-based tracks, or pre-authored mesh tracks?
4. How do they handle the transition between different track segments?

### Technical Questions

1. **Is our approach fundamentally flawed?**
   - Should we be using trimesh physics bodies instead of raycasting?
   - Should we separate visual mesh from collision mesh?

2. **Is the warping from binormal calculation inevitable?**
   - Should we use a different method to generate track cross-sections?
   - Should we pre-compute normals/binormals with more smoothing passes?

3. **Is suspension oscillation the real culprit?**
   - Should we add additional damping outside CANNON's system?
   - Should we smooth the suspension length over multiple frames?

4. **Should we decouple visual from physics?**
   - Keep stepped physics but interpolate visuals more aggressively?
   - Use heightmap for physics but spline mesh for visuals?

## Reference Materials

### File Locations
- **Smooth raycasting**: `/src/smoothRaycast.ts` (lines 35-224)
- **Track generation**: `/src/track.ts` (lines 36-140)
- **Vehicle setup**: `/src/cannonTest.ts` (lines 370-450)
- **Physics integration**: `/src/cannonTest.ts` (lines 813-844)

### Key Observations
1. Console logs show raycasts hitting continuously with smooth distances (e.g., 0.738m, 0.739m, 0.741m)
2. Wheels stay in contact (4/4) even when stepping occurs
3. Suspension compression values oscillate but within normal range (0-40%)
4. The stepping appears to be in the **visual render**, not just the physics simulation

### Screenshots
- [Attached] Shows visible track warping on inner curve
- Collision boxes (green) show discrete steps underneath
- Track mesh (dark) shows smooth surface but with warping

## Desired Outcome
**Perfectly smooth driving on all track surfaces** with no visible stepping, warping, or jitter - similar to professional arcade racing games.

## Additional Context
- This is a learning project exploring physics-based racing
- We chose CANNON-ES for educational purposes (understand the math)
- We're open to alternative approaches if raycasting isn't the right solution
- Performance is not currently a concern (running at 60 FPS)

---

**Thank you for any insights or suggestions!** This has been a multi-day investigation and we'd greatly appreciate fresh perspectives on the problem.
