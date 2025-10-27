# Drift Physics Problem Summary - Touge Racer

## Current Problem Statement

**The car will not drift despite extensive tuning attempts.** Specifically:

1. **Cannot initiate drift** - Handbrake (space) does nothing observable
2. **No counter-steering** - When car does rotate, steering has no effect on controlling the slide
3. **Car just grips** - Feels like driving on rails, no sliding behavior at all
4. **Excessive oversteer when it does happen** - When the rear does break loose (rare), it immediately spins out uncontrollably

## Expected Behavior (Not Happening)

A proper arcade drift should:
- Handbrake + turn → rear kicks out, car rotates into drift
- Throttle + turn → power oversteer, rear slides out
- Counter-steering → controls drift angle, prevents spinout
- Modulating throttle → adjusts drift angle and speed

## Current Behavior (Actual)

- Handbrake + turn → nothing visible happens, car continues gripping
- Throttle + turn → car just turns normally with full traction
- Steering during any rotation → no effect, can't control slides
- Car either grips 100% or spins out 100%, no middle ground

---

## Codebase Architecture

### Physics System (Bicycle Model)
**File:** `src/carPhysics.ts`

The car uses a 2-DOF bicycle model:
- **Front axle** and **rear axle** with slip angles
- **Tire model** (`arcadeTireForce`) - arcade-style force curve
- **Weight transfer** - load distribution affects grip
- **Yaw dynamics** - rotational physics from tire forces

### Key Physics Flow:
1. Calculate slip angles for front/rear tires (lines 195-196)
2. Apply tire model to get lateral forces (lines 198-199)
3. Apply forces to get longitudinal/lateral acceleration (lines 233-237)
4. Update yaw rate from tire moment arms (line 249)
5. Apply damping and limits (lines 260-267)
6. Update position and velocity (lines 243-244, 296-305)

### Track System
**File:** `src/track.ts`

- Uses Catmull-Rom spline with control points
- Frenet frames for tangent/normal/binormal vectors
- Car projects onto track surface and sits at `rideHeight` above it
- 32m wide track (3-4 car widths)

---

## Attempted Fixes (Chronological)

### Phase 1: Initial Drift Tuning
**Goal:** Make car more "slidey"

**Changes Made:**
- Reduced `rearGripHighSpeedScale`: 0.8 → 0.5 → 0.38 → 0.28
- Increased `weightTransferGain`: 0.45 → 0.55 → 0.62
- Increased `throttleOversteerStrength`: 2.8 → 4.0 → 4.8
- Steepened tire falloff: 0.5 → 0.18 → 0.35 coefficient

**Result:** Car became uncontrollable but still wouldn't drift normally. Spun out instead of sliding.

### Phase 2: Investigation and Root Cause Analysis
**Two comprehensive investigations run by specialized agents:**

#### Investigation 1: Track Attachment Issues
**Findings:**
- Track normals potentially inverted (pointing down instead of up)
- Boundary velocity correction actively suppressing lateral velocity
- Weak lateral constraints allowing car to escape track

**Fixes Applied:**
- Tested normal direction (carPhysics.ts:307, track.ts:70)
- Removed boundary velocity correction entirely (carPhysics.ts:333-346)
- Removed track undulation for geometric consistency

#### Investigation 2: Drift Physics Bottlenecks
**Findings (5 critical issues identified):**

1. **Boundary velocity correction** (lines 340-343) - Canceled 110% of lateral velocity + 98.5% speed damping
2. **Excessive yaw damping** (line 260) - 30% per second prevented rotation buildup
3. **Restrictive yaw limit** (line 266) - 45°/s cap prevented rapid rotation
4. **Tire model too grippy** (lines 128-136) - Maintained 85% force at 2x slip
5. **Cross-coupled damping** (line 247) - Fought against yaw-induced lateral motion

**Fixes Applied:**
- Removed boundary velocity correction
- Reduced yaw damping: 30% → 12%
- Increased yaw limit: 45°/s → 70°/s
- Steepened tire falloff: 0.18 → 0.35
- Removed cross-coupling from lateral velocity

### Phase 3: Counter-Steering and Control Fixes
**Goal:** Enable counter-steering to control drifts

**Changes Made:**

1. **Removed handbrake front grip penalty** (line 180)
   - Before: Handbrake applied 15% grip to BOTH front and rear
   - After: Handbrake only affects rear (25% grip), front keeps 100%

2. **Removed cross-coupled lateral damping** (line 247)
   - Before: `vLat += (ay - crossLat) * dt`
   - After: `vLat += ay * dt`
   - This was actively fighting counter-steering forces

3. **Increased high-speed steering limit** (line 444)
   - Before: 38% steering authority at speed
   - After: 70% steering authority at speed

4. **Rebalanced rear grip** (line 443)
   - 0.28 was too low (instant spinout)
   - Increased to 0.52 for controllability

5. **Fixed handbrake rear grip** (line 449)
   - Before: 0.01 (1% grip = uncontrollable)
   - After: 0.25 (25% grip = controllable slide)

6. **Improved handbrake direction logic** (line 271)
   - Now uses steering input to determine yaw direction

**Result:** Still no drifting observed.

### Phase 4: Track Redesign
**Goal:** Create proper touge-style mountain pass

**Changes Made:**
- 60 control points (vs 41 before)
- ~3km long track
- Constant 32m width for multi-car racing
- Variety of corners: sweepers, hairpins, chicanes, esses

**Result:** Track works fine, but drift physics still broken.

---

## Current Configuration Values

**File:** `src/carPhysics.ts` (lines 417-451)

```typescript
// Core physics
mass: 1220 kg
inertia: 1320 kg⋅m²
wheelBase: 2.54m
corneringStiffnessFront: ~38,000 N/rad
corneringStiffnessRear: ~25,000 N/rad

// Grip scaling
frontGripHighSpeedScale: 0.85  (85% front grip at high speed)
rearGripHighSpeedScale: 0.52   (52% rear grip at high speed)

// Steering
maxSteerAngle: 32°
highSpeedSteerLimit: 0.7  (70% at speed)
steerLowSpeedFactor: 0.36

// Drift mechanics
weightTransferGain: 0.58
throttleOversteerStrength: 3.5
handbrakeRearScale: 0.25  (25% rear grip with handbrake)
handbrakeYawBoost: 150°/s

// Yaw dynamics
yawRateLimit: 45°/s (normal), 70°/s (actual limit from line 266), 80°/s (drift mode)
yawDamping: 12% (normal), 15% (drift mode)

// Tire model (arcadeTireForce)
slipAngleAtPeak: ~10-22° (varies with driftControl)
Post-peak falloff: factor = 1.0 / (1.0 + 0.35 * (normalizedSlip - 1.0))
```

---

## Key Code Sections

### Tire Force Calculation
**Location:** `carPhysics.ts:123-137`

```typescript
function arcadeTireForce(slipAngle: number, peakSlip: number, maxForce: number): number {
  const normalizedSlip = Math.abs(slipAngle) / peakSlip;
  let factor: number;
  if (normalizedSlip < 1.0) {
    factor = normalizedSlip * (2 - normalizedSlip * normalizedSlip * 0.3);
  } else {
    // At 2x slip: ~74% force, at 3x: ~60%, at 4x: ~51%
    factor = 1.0 / (1.0 + 0.35 * (normalizedSlip - 1.0));
  }
  return maxForce * factor * Math.sign(slipAngle);
}
```

### Grip Calculation
**Location:** `carPhysics.ts:179-193`

```typescript
const frontGripScale = THREE.MathUtils.lerp(1, config.frontGripHighSpeedScale, highSpeedFactor);
const rearGripScale = THREE.MathUtils.lerp(1, config.rearGripHighSpeedScale, highSpeedFactor);

// Weight transfer from throttle/brake
const totalTransfer = THREE.MathUtils.clamp(
  (input.brake * 0.65 - input.throttle * 0.8) * config.weightTransferGain,
  -0.35,
  0.35
);
const frontLoad = THREE.MathUtils.clamp(1 + totalTransfer, 0.75, 1.5);
const rearLoad = THREE.MathUtils.clamp(1 - totalTransfer, 0.4, 1.4);

// Handbrake only affects rear
const handbrakeRearScale = input.handbrake > 0 ? config.handbrakeRearScale : 1;

// Front: full grip for steering
const Cf = config.corneringStiffnessFront * frontGripScale * frontLoad * (1 + 0.08 * lowSpeedBoost);

// Rear: reduced by throttle oversteer and handbrake
const throttleOversteer = THREE.MathUtils.clamp(
  input.throttle * steerMagnitude * config.throttleOversteerStrength,
  0,
  0.98
);
const rearGripMultiplier = Math.max(0.05, 1 - throttleOversteer);
const Cr = config.corneringStiffnessRear * rearGripScale * rearLoad * rearLowSpeedDrop * rearGripMultiplier * handbrakeRearScale;
```

### Handbrake Logic
**Location:** `carPhysics.ts:269-275`

```typescript
if (input.handbrake > 0) {
  const hbDir = steerInput !== 0 ? Math.sign(steerInput) : Math.sign(state.yawRate || 1);
  state.yawRate += hbDir * config.handbrakeYawBoost * input.handbrake * dt;
  const dragScale = Math.min(config.handbrakeDrag * input.handbrake * dt, 0.08);
  vLong *= 1 - dragScale;
}
```

### Velocity Update (Critical Section)
**Location:** `carPhysics.ts:239-247`

```typescript
const oldVLat = vLat;

// Centripetal coupling
const crossLong = THREE.MathUtils.clamp(state.yawRate * oldVLat, -18, 18);
// Cross-coupling removed from lateral velocity

vLong += (ax + crossLong) * dt;
vLat += ay * dt;  // Changed from: vLat += (ay - crossLat) * dt
```

---

## Potential Issues Not Yet Addressed

### 1. Slip Angle Calculation
**Location:** `carPhysics.ts:195-196`

```typescript
const alphaFront = Math.atan2(vLat + config.cgToFrontAxle * state.yawRate, effectiveSpeed) - state.steerAngle;
const alphaRear = Math.atan2(vLat - config.cgToRearAxle * state.yawRate, effectiveSpeed);
```

**Question:** Is `effectiveSpeed` clamped too high? `Math.max(Math.abs(vLong), 0.6)` might prevent low-speed drift initiation.

### 2. Yaw Response Scaling
**Location:** `carPhysics.ts:249-253`

```typescript
const yawAcc = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;
const yawResponse = THREE.MathUtils.lerp(config.yawLowSpeedFactor, 1, steerSpeedFactor) *
                    THREE.MathUtils.lerp(1, 0.75, highSpeedFactor);
state.yawRate += yawAcc * dt * yawResponse;
```

**Question:** The `yawResponse` multiplier scales down to 0.75 at high speed and 0.12 at low speed. Could this be preventing rotation?

### 3. Throttle Oversteer Dependency
**Location:** `carPhysics.ts:190-191`

```typescript
const steerMagnitude = THREE.MathUtils.clamp(Math.abs(state.steerAngle) / THREE.MathUtils.degToRad(14), 0, 1);
const throttleOversteer = THREE.MathUtils.clamp(input.throttle * steerMagnitude * config.throttleOversteerStrength, 0, 0.98);
```

**Question:** Throttle oversteer REQUIRES steering input (`steerMagnitude`). Can you even power-slide without turning?

### 4. Drift Mode Bootstrap Problem
**Location:** `carPhysics.ts:349-360`

```typescript
const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.1));
const slipDeg = THREE.MathUtils.radToDeg(Math.abs(state.slipAngle));
const driftActive = slipDeg > driftThreshold && driftSpeedOk;

if (driftActive) {
  state.driftTime = Math.min(state.driftTime + dt, 5);
  if (state.driftTime > 0.08 && !state.driftMode) {
    state.driftMode = true;
  }
} else {
  // ...
}
```

**Question:** Need 30° slip angle to enter drift mode, but drift mode provides assists. Chicken-and-egg?

### 5. Coordinate System Issues
The earlier investigation found potential coordinate mismatches:
- Track uses Y-up, XZ for horizontal
- Car physics uses 2D vectors mapped to XZ
- Initial yaw calculation: `Math.atan2(startSample.tangent.z, startSample.tangent.x)`

**Question:** Could coordinate confusion prevent tire forces from generating correct lateral motion?

### 6. Normal Direction Still Uncertain
**Location:** `track.ts:70`

```typescript
const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
```

We tested this but never confirmed if normals point up or down. If they point down, the car would be pushed away from the track surface, which might explain grip issues.

---

## Diagnostic Questions for Review

1. **Are tire forces being generated at all?**
   - Check if `Fyf` and `Fyr` are non-zero during turning
   - Add debug logging for slip angles and tire forces

2. **Is lateral velocity (`vLat`) changing?**
   - If `vLat` stays at 0, the car isn't moving sideways at all
   - Could indicate tire forces aren't being applied correctly

3. **Is yaw rate (`state.yawRate`) building up?**
   - Handbrake should add 150°/s per second
   - If yaw rate stays near 0, something is blocking rotation

4. **What are the actual grip values (`Cf`, `Cr`)?**
   - At high speed with handbrake:
     - Front: ~32,000 N/rad (full steering control)
     - Rear: ~3,250 N/rad (25% of ~13,000 base)
   - Are these values reasonable for sliding?

5. **Is the track normal actually pointing upward?**
   - If normal.y < 0, normals are inverted
   - This would break the entire car-to-track attachment

6. **Is there a fundamental coordinate system issue?**
   - Does steering in-game actually generate the expected front slip angle?
   - Test: Turn left → alphaFront should go negative → Fyf should point right

---

## Test Cases That Should Work (But Don't)

### Test 1: Basic Handbrake Drift
**Input:**
1. Accelerate to 40 km/h
2. Turn left (press A or Left Arrow)
3. Tap handbrake (Space)

**Expected:**
- Rear grip drops to 25%
- Yaw rate increases by 150°/s
- Car rotates left
- Rear slides out (visible rotation around front)

**Actual:**
- Nothing observable happens

### Test 2: Power Oversteer
**Input:**
1. Enter corner at 30 km/h
2. Turn right while applying full throttle

**Expected:**
- Weight shifts off rear (load = 0.65)
- Throttle oversteer reduces rear grip further
- Rear slides out
- Car oversteers into drift

**Actual:**
- Car just turns normally with full grip

### Test 3: Counter-Steering
**Input:**
1. If car does start rotating (rare)
2. Steer opposite to rotation direction

**Expected:**
- Front tires generate corrective force
- Rotation slows down
- Car stabilizes at controlled angle

**Actual:**
- No effect from steering
- Car either stops rotating or spins out

---

## Files Modified

1. **src/carPhysics.ts** - Core physics engine
   - Tire model adjustments
   - Grip scaling changes
   - Handbrake mechanics fixes
   - Cross-coupling removal
   - Yaw damping/limits tuning

2. **src/track.ts** - Track generation
   - Removed undulation
   - New mountain pass layout (60 control points)
   - Constant 32m width
   - Banking removed (flat road)

3. **src/main.ts** - Debug UI
   - Removed `handbrakeFrontScale` from sliders (no longer exists)

4. **src/input.ts** - No changes
   - Handbrake: Space, Shift Left, Shift Right
   - Steering: A/D or Arrow keys
   - Throttle: W or Up Arrow

---

## Summary

Despite **extensive tuning across multiple dimensions**, the car will not drift:

**What we've tried:**
- Reduced rear grip repeatedly (0.8 → 0.5 → 0.38 → 0.28 → 0.52)
- Removed velocity corrections that fought sliding
- Fixed handbrake to not kill front grip
- Removed cross-coupling that prevented counter-steering
- Increased steering authority for drift control
- Adjusted tire model falloff curves
- Reduced yaw damping and increased limits
- Rebalanced weight transfer and oversteer strength

**What's still broken:**
- Car doesn't slide at all (feels like it's on rails)
- Handbrake has no visible effect
- Counter-steering doesn't work
- No middle ground between full grip and spinout

**Likely root causes to investigate:**
1. Tire forces not being generated correctly
2. Lateral velocity not accumulating (stays at 0)
3. Coordinate system mismatch preventing proper force application
4. Track normals pointing wrong direction
5. Some fundamental physics bug in the bicycle model implementation
6. Yaw response scaling too aggressive (killing rotation)

The car physics appear to be fundamentally broken at a deeper level than parameter tuning can fix.
