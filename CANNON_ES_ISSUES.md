# Cannon-ES Vehicle Physics Implementation - Issue Report

## ✅ RESOLVED (2025-01-06)

**All issues have been fixed!** The car now drives smoothly on the mountain track with proper physics.

### Final Solution: Segmented Oriented Boxes

Instead of using Trimesh collision (which caused instability), we implemented **oriented box collision**:

1. **Track divided into 5m segments** (900 boxes total for 3.3km track)
2. **Boxes oriented using quaternions** from track tangent/normal/binormal vectors
3. **Key fix: Flipped normals** - Track normals pointed down (Y=-1), boxes need up (Y=+1)
4. **Proper quaternion math** - Build rotation matrix from orthonormal basis then convert to quaternion

### Working Configuration

```typescript
// Vehicle
mass: 150kg
angularDamping: 0.8
centerOfMassOffset: (0, -0.5, 0)

// Suspension
stiffness: 100 (was 30 - too weak)
restLength: 0.5m
dampingCompression: 8.0
dampingRelaxation: 5.0
maxSuspensionForce: 10000N
```

### Critical Fixes

1. ✅ **Initialize collision before raycasts** - `world.step(1/60)` before vehicle creation
2. ✅ **Flip track normals** - `upNormal = sample.normal.clone().multiplyScalar(-1)`
3. ✅ **Stronger suspension** - Stiffness 100 supports 150kg chassis properly
4. ✅ **Oriented boxes** - Proper matrix math: `makeBasis(binormal, upNormal, tangent)`
5. ✅ **Disable chassis collision** - Only wheels touch ground
6. ✅ **10cm box overlap** - Prevents seam gaps between segments

### Files

- `src/cannonTest.ts` - Main vehicle setup
- `src/trackCollision.ts` - Collision box generation with proper orientation
- `README.md` - Updated with current system

---

## Historical Context: Original Issues (ARCHIVED)

The following documents the debugging journey that led to the solution above. This implementation used Trimesh collision and had fundamental issues.

## Goal
Implement proper vehicle physics using cannon-es RaycastVehicle to replace the existing arcade drift physics. The original arcade physics had direction issues where "when turn right to initiate drift it seems to slide towards the left slightly."

## Original Status: ❌ NOT WORKING (Trimesh approach)

**Symptom:** Car is being thrown up in the air, tumbling, and not settling on the track properly.

**What IS Working:**
- ✅ Physics world created correctly (gravity, solver, materials)
- ✅ Chassis body spawns at correct position
- ✅ Vehicle with 4 wheels configured
- ✅ Track collision mesh (Trimesh) created from Three.js geometry (3602 vertices, 7200 triangles double-sided)
- ✅ Ground plane fallback at Y=-10
- ✅ Wheel raycasts ARE detecting ground contact (briefly shows 3/4 wheels in contact)
- ✅ `vehicle.updateVehicle()` is being called before world.step()

**What's NOT Working:**
- ❌ Car tumbles/rotates uncontrollably after initial ground contact
- ❌ Car bounces violently and gets launched into the air
- ❌ Quaternion becomes unstable (flipping, spinning)
- ❌ Physics never stabilizes - car continues flying/tumbling indefinitely

---

## Console Output Analysis

### Initial Spawn (GOOD)
```
🚗 Car spawn: { position: "(0.0, 70.0, 0.0)", yaw: "-108.4°", quaternion: "(0.00, -0.81, 0.00, 0.58)" }
🚗 Vehicle created with 4 wheels
  Wheel 0-3: connection positions, radius=0.55, suspensionRestLength=1.00
🔍 Track mesh first 3 vertices:
  Vertex 0: (-11.4, 60.0, 3.8)
  Vertex 1: (11.4, 60.0, -3.8)
  Vertex 2: (-11.9, 60.0, 2.2)
🔧 Created double-sided trimesh: 7200 triangles (3600 original)
✓ Added ground plane at Y=-10
✓ Created track collision: 3602 vertices, 7200 triangles
```

**Analysis:**
- Track surface is at Y=60
- Car spawns at Y=70 (10 meters above track)
- Orientation looks correct

### Physics Simulation - First Attempt (PROBLEM IDENTIFIED)

```
Frame 20:  pos: "(0.0, 69.4, 0.0)", vel: "(0.0, -3.3, 0.0)", quat: "(0.00, -0.81, 0.00, 0.58)", wheelsInContact: "0/4"
Frame 40:  pos: "(0.0, 67.8, 0.0)", vel: "(0.0, -6.5, 0.0)", quat: "(0.00, -0.81, 0.00, 0.58)", wheelsInContact: "0/4"
Frame 60:  pos: "(0.0, 64.9, 0.0)", vel: "(0.0, -9.9, 0.0)", quat: "(0.00, -0.81, 0.00, 0.58)", wheelsInContact: "0/4"
Frame 80:  pos: "(0.1, 61.5, 0.0)", vel: "(2.5, -2.7, 0.6)", quat: "(0.06, -0.81, -0.09, 0.58)", wheelsInContact: "3/4"
          Wheel 0: contact=true, suspensionLength=0.93m
          Wheel 1: contact=true, suspensionLength=0.50m
          Wheel 2: contact=true, suspensionLength=0.69m
          Wheel 3: contact=false, suspensionLength=1.00m
Frame 100: pos: "(0.7, 61.2, 0.3)", vel: "(1.5, -2.1, 0.9)", quat: "(0.18, -0.62, -0.66, 0.38)", wheelsInContact: "0/4"
Frame 120: pos: "(1.2, 59.7, 0.6)", vel: "(1.9, -6.8, 0.5)", quat: "(0.18, -0.27, -0.93, 0.17)", wheelsInContact: "0/4"
```

**Critical Analysis:**

1. **Frames 20-60**: Car falling normally (0/4 wheels in contact) - expected behavior
2. **Frame 80**: 🎯 **FIRST CONTACT** - 3/4 wheels touch track surface
   - BUT quaternion starts changing: `(0.06, -0.81, -0.09, 0.58)` - car tilting
   - Lateral velocity appears: X=2.5, Z=0.6 - car rotating/sliding
3. **Frame 100**: ❌ **TUMBLING BEGINS**
   - Quaternion rotated drastically: `(0.18, -0.62, -0.66, 0.38)` - car flipped
   - 0/4 wheels in contact - car bounced off track
4. **Frame 120**: ❌ **OUT OF CONTROL**
   - Quaternion completely different: `(0.18, -0.27, -0.93, 0.17)` - spinning
   - Still falling (vel Y=-6.8) - never recovered

---

## Root Cause Analysis

### Issue 1: Initial Raycast Range Too Short
**Problem:** Wheels spawn at Y=69.55 (chassis Y=70 - 0.45), but:
- Original suspension rest length: 1.0m
- Max travel: 0.5m
- Total raycast distance: 1.5m
- Raycasts reach down to Y=68.05

**Track is at Y=60 → 8.05 meters BELOW raycast range!**

Car must fall to chassis Y=61.5 before wheels can even detect the track. By then, it has significant downward velocity (13+ m/s) causing hard impact.

### Issue 2: Violent Impact on Landing
When wheels finally make contact at frame 80:
- Car has been falling for ~60 frames
- Velocity: 13 m/s downward
- Suspension force (maxSuspensionForce: 100000) tries to stop this instantly
- Result: MASSIVE upward impulse that launches car back into air

### Issue 3: Asymmetric Landing Causes Rotation
Frame 80 shows only 3/4 wheels in contact with varying suspension lengths:
- Wheel 0: 0.93m
- Wheel 1: 0.50m ← compressed more
- Wheel 2: 0.69m
- Wheel 3: 1.00m (no contact)

Uneven suspension forces create torque → car starts rotating.

### Issue 4: Low Angular Damping Can't Stop Rotation
- Original angular damping: 0.01 (very low)
- Once rotation starts, nothing stops it
- Car enters tumble loop: rotate → lose ground contact → fall → impact → rotate more

---

## Implementation Details

### File: `/Users/mick/code/github/Touge-Racer/src/carPhysicsCannon.ts`

**Current Configuration:**
```typescript
// Chassis
const chassisShape = new CANNON.Box(new CANNON.Vec3(1.7, 0.55, 3.05));
const chassisBody = new CANNON.Body({
  mass: 1200,
  linearDamping: 0.01,
  angularDamping: 0.5,  // Recently increased (was 0.01)
});

// Spawn
const spawnHeight = 2.0;  // Recently reduced (was 10.0)
chassisBody.position.set(startX, startY + 2.0, startZ);

// Wheels
const wheelOptions = {
  radius: 0.55,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 30,
  suspensionRestLength: 0.7,    // Recently adjusted (was 1.0)
  frictionSlip: 5,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 50000,    // Recently reduced (was 100000)
  rollInfluence: 0.01,
  maxSuspensionTravel: 0.5,
};

// Wheel positions relative to chassis center
const wheelPositions = [
  new CANNON.Vec3(-1.45, -0.45, 1.9),   // Front left
  new CANNON.Vec3(1.45, -0.45, 1.9),    // Front right
  new CANNON.Vec3(-1.45, -0.45, -1.9),  // Rear left
  new CANNON.Vec3(1.45, -0.45, -1.9),   // Rear right
];
```

**Physics Step:**
```typescript
export function stepCannonCar(state: CannonCarState, input: InputSnapshot, dt: number) {
  const { vehicle, chassisBody, world } = state;
  const fixedTimeStep = 1 / 60;
  const maxSubSteps = 3;

  // Apply controls (steering, throttle, brake, handbrake)
  // ... control code ...

  // CRITICAL: Update vehicle raycasts
  vehicle.updateVehicle(fixedTimeStep);

  // Step physics
  world.step(fixedTimeStep, dt, maxSubSteps);

  // Calculate telemetry
  // ... telemetry code ...
}
```

**Track Collision:**
- Extracts Three.js BufferGeometry vertices and indices
- Creates double-sided Trimesh (reversed winding for back faces)
- Static body with ContactMaterial (friction: 0.9)
- Ground plane fallback at Y=-10

---

## Fixes Attempted (Did Not Resolve Issue)

### Attempt 1: Double-Sided Trimesh ✅ (Partially worked)
- Added reversed triangles for double-sided collision
- Result: Wheels now detect collision (3/4 contact achieved)
- Did NOT fix: Car still tumbles after contact

### Attempt 2: Added `vehicle.updateVehicle()` ✅ (Essential)
- Ensures raycasts update before physics step
- Result: Raycasts work correctly
- Did NOT fix: Car still tumbles

### Attempt 3: Lower Spawn Height ⚠️ (Reduced from 10m to 2m)
- Reduces fall distance and impact velocity
- Result: Unknown - still tumbling reported
- May have helped but not enough

### Attempt 4: Increase Angular Damping ⚠️ (0.01 → 0.5)
- Should resist rotation
- Result: Still tumbling reported
- Either insufficient or another force is dominant

### Attempt 5: Reduce Suspension Force ⚠️ (100000 → 50000)
- Should reduce bounce impulse
- Result: Still being "thrown up in the air"
- Force may still be too high, or timing issue

---

## Potential Issues Not Yet Addressed

### 1. **Chassis Colliding with Track**
The chassis itself has collision enabled:
```typescript
chassisShape.collisionResponse = true;
```

If the chassis hits the track mesh before/during wheel contact, it could:
- Generate large collision forces
- Cause the car to bounce/tumble
- Interfere with suspension forces

**Recommendation:** Try disabling chassis collision (`collisionResponse = false`) since RaycastVehicle should handle ground contact through wheels only.

### 2. **Trimesh Collision Unreliable**
Cannon.js Trimesh collision is notoriously finicky:
- Raycasts can pass through thin triangles
- Performance issues with complex meshes
- Potential for tunneling at high velocities

**Recommendation:** Consider using a simpler collision shape:
- Heightfield (if track is roughly flat)
- Series of box segments along the track
- Convex hulls for track sections

### 3. **Suspension Math May Be Wrong**
The RaycastVehicle suspension in cannon-es has specific requirements:
- `suspensionRestLength` should be the distance from chassis to ground when at rest
- Wheel position Y coordinate affects where raycast starts
- These must be coordinated correctly

**Current setup:**
- Wheel connection: Y = -0.45 (below chassis center)
- Suspension rest: 0.7m
- Wheel radius: 0.55m

**Expected ride height:** 0.45 + 0.7 + 0.55 = **1.7m** total height from chassis center to ground

**Recommendation:** Verify this matches the visual car model and track surface geometry.

### 4. **ContactMaterial Not Applied to Wheels**
The ContactMaterial is created between `wheelMaterial` and `trackMaterial`, but the wheels themselves don't have the material assigned. RaycastVehicle wheels might not use materials the same way rigid bodies do.

**Recommendation:** Research cannon-es RaycastVehicle documentation for proper material/friction setup.

### 5. **Quaternion Orientation Issue**
The car spawns with quaternion `(0.00, -0.81, 0.00, 0.58)` which represents a yaw of -108.4°. This is pointing the car along the track tangent, but:
- Is the up vector correct?
- Could starting rotated be causing instability?

**Recommendation:** Try spawning with identity quaternion `(0, 0, 0, 1)` (no rotation) to test if orientation is a factor.

### 6. **World Solver Settings**
Current settings:
- Solver iterations: 10
- Fixed timestep: 1/60
- Max substeps: 3

These might be insufficient for stable vehicle simulation.

**Recommendation:** Increase solver iterations to 20-30 and test if stability improves.

---

## Recommended Next Steps

### High Priority Fixes:

1. **Disable Chassis Collision**
   ```typescript
   chassisShape.collisionResponse = false;
   ```
   Let only the wheels handle ground contact.

2. **Simplify Track Collision**
   Replace Trimesh with simpler collision geometry:
   - Box segments along track centerline
   - Or a flat plane for initial testing

3. **Increase Suspension Damping**
   ```typescript
   dampingRelaxation: 5.0,    // Was 2.3
   dampingCompression: 8.0,   // Was 4.4
   ```
   This adds more resistance to compression/extension oscillation.

4. **Lower Car Mass or Increase Stiffness**
   Current mass: 1200kg might be too heavy for suspension settings.
   Try: 800kg or increase suspensionStiffness to 50.

5. **Test with Ground Plane Only**
   Comment out Trimesh creation, use only the ground plane at Y=60:
   ```typescript
   groundBody.position.set(0, 60, 0);  // Match track surface
   ```
   This isolates whether the issue is Trimesh collision or vehicle configuration.

### Debug Additions Needed:

Add logging for:
- Contact normals (are collisions from expected direction?)
- Suspension forces applied each frame
- Angular velocity magnitude
- Whether chassis is colliding with track

---

## Key Files

- **Physics Implementation:** `/Users/mick/code/github/Touge-Racer/src/carPhysicsCannon.ts`
- **Integration:** `/Users/mick/code/github/Touge-Racer/src/main.ts` (lines 168-170, 589-606)
- **Track Geometry:** `/Users/mick/code/github/Touge-Racer/src/track.ts`
- **Original Arcade Physics:** `/Users/mick/code/github/Touge-Racer/src/carPhysics.ts` (still in codebase, can toggle with 'C' key)

## Branch
Currently on: `cannon-es-physics`

## Testing
- Dev server: http://localhost:5174/
- Press F12 for console debug output
- Press C to toggle between Cannon-ES and Arcade physics
- Debug logging shows first 120 frames, every 20 frames

---

## Summary

The cannon-es RaycastVehicle implementation successfully:
- Creates physics world
- Spawns vehicle with correct geometry
- Detects ground collision via raycasts

But FAILS because:
- Violent impact forces on landing
- Uncontrolled rotation/tumbling
- Never stabilizes into drivable state

**Most Likely Root Cause:** Combination of:
1. Chassis collision interfering with suspension
2. Suspension forces too strong/poorly damped
3. Trimesh collision creating unpredictable contact normals
4. Insufficient angular damping to resist rotation once started

**Recommended Approach:** Start simple (ground plane, no chassis collision) and add complexity incrementally while testing stability at each step.
