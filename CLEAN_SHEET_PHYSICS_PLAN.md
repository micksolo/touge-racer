# Clean-Sheet Drift Physics Redesign - Complete Plan

## Executive Summary

**Goal:** Eliminate "artificial" feeling by building pure physics foundation with arcade-tuned parameters for controllable, predictable drift mechanics.

**Current Problem:** Multiple conflicting systems (speed-based grip scaling, artificial corrections, weight transfer inconsistencies) create unpredictable behavior and oscillations.

**Solution:** Strip to pure bicycle model physics + simplified but CONSISTENT parameters that players can learn and master.

---

## Problem Analysis: Why Current Physics Feels "Artificial"

### Current Issues

1. **Speed-Based Grip Scaling (lines 186-187)**
   ```typescript
   const frontGripScale = lerp(1, 0.58, highSpeedFactor);
   const rearGripScale = lerp(1, 0.48, highSpeedFactor);
   ```
   - Grip magically changes with speed
   - Not based on any physical phenomenon
   - Makes behavior unpredictable: "Why does it work at 60 km/h but not 100 km/h?"

2. **Oscillation from Front Restoring Forces**
   - User reports: "car snaps back and overcorrects"
   - Telemetry shows: yawRate 45° → 72° → 26° with constant steering input
   - Front forces overpower → oscillate → unpredictable

3. **Throttle/Weight Transfer Conflicts**
   - Throttle on: car straightens (rear loads up)
   - Throttle off: car drifts
   - This is BACKWARDS from real drifting (throttle controls drift angle)

4. **Artificial Corrections Removed But Left Instability**
   - Removed auto-centering → car spins forever
   - Had to add back arbitrary damping
   - Band-aid solutions, not root cause fixes

5. **Steering Holds Position Artificially**
   - No self-aligning torque from tire forces
   - Unrealistic: real steering wheels return to center from physics

### Root Cause

**Multiple simplified/artificial systems that conflict with each other instead of working together.**

---

## Design Philosophy: Pure Physics + Arcade Parameters

### Core Principle

**Use REAL physics equations, but with simplified/tuned parameters that give arcade feel.**

**Good Arcade Physics:**
- Initial D: Simple but consistent rules, learnable, skill-based
- Ridge Racer: Exaggerated but predictable behavior
- Need for Speed: Easy to initiate, hard to master

**Bad Arcade Physics:**
- Hidden corrections fighting player
- Inconsistent behavior (works sometimes, not others)
- Oscillations and unpredictable responses

### What Makes Arcade "Feel"

1. **Easy Initiation:** Low barrier to entry (handbrake → drift)
2. **Progressive Control:** Throttle/steering modulates drift angle smoothly
3. **Catchable:** Counter-steering can always catch slides (no instant spinouts)
4. **Consistent:** Same input → same output (learnable)
5. **Forgiving:** Mistakes are recoverable

**These come from parameter tuning (tire peak slip, grip ratios), NOT from artificial systems!**

---

## What We Keep (Pure Physics Core)

### 1. Bicycle Model Dynamics ✓

**Lines 246-247, 257:**
```typescript
vLong += (ax + state.yawRate * oldVLat) * dt;
vLat += (ay - state.yawRate * oldVLong) * dt;

yawAcc = (cgToFrontAxle * Fyf - cgToRearAxle * Fyr) / inertia;
state.yawRate += yawAcc * dt;
```

**Why Keep:** This IS real physics. Coriolis coupling is essential for drifting.

### 2. Geometric Slip Angle Calculation ✓

**Lines 197-198:**
```typescript
alphaFront = atan2(vLat + cgToFrontAxle * yawRate, effectiveSpeed) - steerAngle;
alphaRear = atan2(vLat - cgToRearAxle * yawRate, effectiveSpeed);
```

**Why Keep:** Geometrically correct. This is how slip angles actually work.

### 3. Force-Based Dynamics ✓

**Lines 200-201, 239:**
```typescript
Fyf = -arcadeTireForce(alphaFront, peakSlip, Cf);
Fyr = -arcadeTireForce(alphaRear, peakSlip, Cr);
ay = (Fyf + Fyr) / mass;
```

**Why Keep:** Proper force → acceleration → velocity integration. Real physics.

### 4. Euler Integration ✓

**dt-based updates throughout**

**Why Keep:** Correct numerical integration method for real-time physics.

---

## What We Remove (Artificial/Broken)

### 1. Speed-Based Grip Scaling ✗

**Current (lines 186-187):**
```typescript
const frontGripScale = THREE.MathUtils.lerp(1, 0.58, highSpeedFactor);
const rearGripScale = THREE.MathUtils.lerp(1, 0.48, highSpeedFactor);
```

**Why Remove:**
- Arbitrary: No physical basis
- Unpredictable: Behavior changes with speed for no reason player can learn
- Conflicts: Interacts badly with weight transfer

**Replace With:** Constant grip values (front/rear bias only)

### 2. Percentage-Based Yaw Damping ✗

**Current (line 261):**
```typescript
state.yawRate *= 1 - Math.min(dt * 0.015, 0.01);
```

**Why Remove:**
- Not force-based physics
- Arbitrary percentage
- Real damping comes from aerodynamic drag: F = k * ω²

**Replace With:** Proper aerodynamic drag torque

### 3. effectiveSpeed Floor Hack ✗

**Current (line 184):**
```typescript
const effectiveSpeed = Math.max(Math.abs(vLong), 0.6);
```

**Why Remove:**
- Band-aid to prevent large slip angles at low speed
- Causes weird behavior: slip angles don't grow properly
- Real solution: proper tire model that handles large slip angles

**Replace With:** Remove floor, tune tire model to handle 0-speed correctly

### 4. Steering Holds Position ✗

**Current (lines 176-182):**
```typescript
if (Math.abs(steerInput) > 0.01) {
  // Only move when input
}
```

**Why Remove:**
- Unrealistic: real wheels return to center from tire forces
- Artificial: not based on physics
- Confusing: player doesn't know wheel will "stick"

**Replace With:** Self-aligning torque from tire forces

### 5. Multiple Conflicting Weight Transfer Terms ✗

**Current (line 188):**
```typescript
totalTransfer = (brake * 0.65 + handbrake * 0.30 - throttle * 0.25) * 0.55;
```

**Why Remove:**
- Arbitrary coefficients (why 0.65 vs 0.30 vs 0.25?)
- Tuned by feel, not physics
- Creates conflicts (throttle loads rear, prevents drifts)

**Replace With:** Single unified calculation from longitudinal acceleration

---

## What We Simplify (Arcade Tuning Parameters)

### 1. Tire Model: Simplified Curve

**Keep simplified function, but tune parameters:**

```typescript
function arcadeTireForce(slipAngle, peakSlip, maxForce) {
  const normalized = abs(slipAngle) / peakSlip;

  if (normalized < 1.0) {
    // Before peak: smooth rise
    factor = normalized * normalized * (3 - 2 * normalized);
  } else {
    // After peak: slow falloff for catchability
    factor = 1.0 / (1.0 + falloffRate * (normalized - 1.0));
  }

  return maxForce * factor * sign(slipAngle);
}
```

**Arcade Tuning:**
- `peakSlip = 25-35°` (higher than real tires for drift range)
- `falloffRate = 0.15` (slower falloff = more catchable)
- Keeps good force even at 40-50° for counter-steering

**Why This Works:**
- Simplified from Pacejka magic formula
- But maintains realistic shape: rise → peak → falloff
- Parameters tuned for arcade feel, not maximum realism

### 2. Grip Levels: Constant Front/Rear Bias

**No speed scaling, just constant values:**

```typescript
// Configuration
const frontCorneringStiffness = 18000;  // Higher for stability
const rearCorneringStiffness = 14000;   // Lower for drift initiation
```

**Arcade Tuning:**
- Front/rear ratio: ~1.3:1 (normal driving)
- With handbrake: ratio becomes ~3:1 (drift range)
- NO speed scaling: behavior is consistent

**Why This Works:**
- Players can learn: "My car has this much grip, always"
- Consistent behavior at all speeds
- Still adjustable through weight transfer (dynamic)

### 3. Weight Transfer: Unified Calculation

**Single source of truth from longitudinal acceleration:**

```typescript
// Calculate actual longitudinal acceleration (from all sources)
const aLong = (engineForce - brakeForce - drag - rolling) / mass;

// Weight transfer from acceleration (forward = negative)
const weightShift = (aLong * mass * heightCG) / (wheelBase * gravity);

const frontLoad = baseLoadFront + weightShift;
const rearLoad = baseLoadRear - weightShift;

// Apply to grip
const Cf = frontCorneringStiffness * frontLoad;
const Cr = rearCorneringStiffness * rearLoad;
```

**Arcade Tuning:**
- `heightCG` can be exaggerated for more weight transfer
- Single formula: no conflicts, no arbitrary coefficients
- Based on real physics: F = ma, weight transfer from acceleration

**Why This Works:**
- Physically consistent
- Throttle naturally modulates rear grip (acceleration affects load)
- Brake/handbrake affect load through actual braking forces
- No arbitrary coefficients to tune separately

### 4. Handbrake: Binary State with Low Friction

**Current (artificial multiplier):**
```typescript
const handbrakeRearScale = input.handbrake > 0 ? 0.45 : 1;
Cr = corneringStiffness * rearLoad * handbrakeRearScale;
```

**New (friction coefficient):**
```typescript
// Handbrake locks rear wheels - use sliding friction
const rearFriction = input.handbrake > 0 ? μ_slide : μ_peak;

// Tire force limited by friction
const Cr = min(corneringStiffness * rearLoad, rearFriction * rearLoad * gravity);
```

**Arcade Tuning:**
- `μ_peak = 1.1` (normal tire grip, slightly above 1.0 for arcade)
- `μ_slide = 0.4` (locked wheels, low friction)
- Results in ~2.75x grip reduction when locked

**Why This Works:**
- Based on real friction: locked wheels = sliding friction
- Binary state: easy to understand (locked or not)
- Still tunable: adjust μ values for arcade feel

### 5. Aerodynamic Drag: Speed²-Based

**Current (percentage damping):**
```typescript
state.yawRate *= 1 - Math.min(dt * 0.015, 0.01);
```

**New (force-based):**
```typescript
// Aerodynamic drag torque opposes rotation
const dragTorque = dragCoeff * state.yawRate * abs(state.yawRate);
const yawAcc_drag = -dragTorque / inertia;

state.yawRate += yawAcc_drag * dt;
```

**Arcade Tuning:**
- `dragCoeff` tunable for feel
- Can be exaggerated for more stabilization
- Physically consistent: grows with speed²

**Why This Works:**
- Real physics: drag grows with velocity squared
- Natural stabilization without arbitrary percentages
- High yaw rates naturally dampen faster

### 6. Self-Aligning Torque: Steering Return

**Current (none - steering holds position):**

**New (from tire forces):**
```typescript
// Front tires generate moment around steering axis
const pneumaticTrail = 0.03;  // ~3cm for typical tire
const aligningTorque = -Fyf * pneumaticTrail;

// Apply to steering with some damping
const steeringInertia = 0.05;
const steeringDamping = 2.0;

const steerAcc = (aligningTorque - steeringDamping * steerVelocity) / steeringInertia;
steerVelocity += steerAcc * dt;
state.steerAngle += steerVelocity * dt;

// Player input adds torque to this system
if (steerInput !== 0) {
  const inputTorque = steerInput * playerTorque;
  // Add to steerAcc calculation
}
```

**Arcade Tuning:**
- `pneumaticTrail` can be exaggerated
- `steeringDamping` prevents oscillation
- Player input can overpower easily

**Why This Works:**
- Real physics: tire lateral forces create moment
- Natural centering without artificial "hold position"
- Player can feel forces through steering
- Tunable for arcade responsiveness

---

## Clean-Sheet Implementation Plan

### Phase 1: Strip Out Artificial Systems

**Step 1.1: Remove Speed-Based Grip Scaling**

Delete:
```typescript
const frontGripScale = THREE.MathUtils.lerp(1, config.frontGripHighSpeedScale, highSpeedFactor);
const rearGripScale = THREE.MathUtils.lerp(1, config.rearGripHighSpeedScale, highSpeedFactor);
```

Replace with constants:
```typescript
const frontGripScale = 1.0;
const rearGripScale = 1.0;
```

Remove config params:
- `frontGripHighSpeedScale`
- `rearGripHighSpeedScale`

**Step 1.2: Remove effectiveSpeed Floor**

Delete:
```typescript
const effectiveSpeed = Math.max(Math.abs(vLong), 0.6);
```

Replace with:
```typescript
const effectiveSpeed = Math.max(Math.abs(vLong), 0.01);  // Minimal to prevent divide-by-zero
```

**Step 1.3: Remove Percentage Yaw Damping**

Delete:
```typescript
state.yawRate *= 1 - Math.min(dt * 0.015, 0.01);
```

(Will be replaced in Phase 2 with proper drag)

**Step 1.4: Remove Steering Hold Position**

Delete:
```typescript
if (Math.abs(steerInput) > 0.01) {
  const targetSteerAngle = ...;
  state.steerAngle += steerError;
}
```

(Will be replaced in Phase 3 with self-aligning torque)

### Phase 2: Implement Unified Weight Transfer

**Step 2.1: Calculate Total Longitudinal Acceleration**

```typescript
// All longitudinal forces
const engineForce = ...;  // existing
const brakeForce = ...;   // existing
const handbrakeForce = ...;  // existing
const dragging = ...;     // existing
const rolling = ...;      // existing

// Net longitudinal force
const Flong = engineForce - dragging - rolling - brakeForce - handbrakeForce + gradeAcceleration * mass;

// Longitudinal acceleration
const aLong = Flong / mass;
```

**Step 2.2: Calculate Weight Transfer from Acceleration**

```typescript
// Weight transfer from longitudinal acceleration
// Forward accel (positive) shifts weight rearward (negative transfer)
// Braking (negative accel) shifts weight forward (positive transfer)

const heightCG = 0.50;  // Center of gravity height (tunable for arcade feel)
const wheelBase = config.cgToFrontAxle + config.cgToRearAxle;

// Transfer as fraction of total weight
const weightTransfer = -(aLong * heightCG) / (wheelBase * GRAVITY);

// Base static loads
const baseLoadFront = config.cgToRearAxle / wheelBase;  // Further from rear = more weight
const baseLoadRear = config.cgToFrontAxle / wheelBase;

// Dynamic loads
const frontLoad = THREE.MathUtils.clamp(baseLoadFront + weightTransfer, 0.3, 1.7);
const rearLoad = THREE.MathUtils.clamp(baseLoadRear - weightTransfer, 0.3, 1.7);
```

**Step 2.3: Apply to Cornering Forces**

```typescript
const Cf = config.corneringStiffnessFront * frontLoad;
const Cr = config.corneringStiffnessRear * rearLoad;
```

**Remove old weight transfer code entirely.**

### Phase 3: Implement Self-Aligning Torque

**Step 3.1: Add Steering Dynamics State**

```typescript
export interface CarState {
  // ... existing
  steerVelocity: number;  // NEW: rad/s
}
```

**Step 3.2: Calculate Self-Aligning Torque**

```typescript
// Pneumatic trail: distance from tire contact patch to lateral force application
const pneumaticTrail = 0.025;  // 2.5cm, tunable

// Self-aligning torque from front tires (opposes slip angle)
const aligningTorque = -Fyf * pneumaticTrail;
```

**Step 3.3: Steering Dynamics**

```typescript
const steeringInertia = 0.08;  // kg⋅m², tunable
const steeringDamping = 3.0;   // N⋅m⋅s/rad, tunable for feel

// Player input torque
const playerSteerRate = config.steerRateHigh;  // Use existing config
const targetSteerAngle = -steerInput * config.maxSteerAngle * steerGain * steerLimit * reverseSteerFlip;
const steerError = targetSteerAngle - state.steerAngle;

// Torque from player input (proportional to error, like spring)
const playerTorque = steerError * playerSteerRate * steeringInertia;

// Total torque
const totalSteerTorque = aligningTorque + playerTorque - steeringDamping * state.steerVelocity;

// Steering acceleration
const steerAcc = totalSteerTorque / steeringInertia;

// Integrate
state.steerVelocity += steerAcc * dt;
state.steerAngle += state.steerVelocity * dt;

// Clamp to max angle
state.steerAngle = THREE.MathUtils.clamp(
  state.steerAngle,
  -config.maxSteerAngle * steerLimit,
  config.maxSteerAngle * steerLimit
);
```

### Phase 4: Implement Aerodynamic Drag Torque

**Step 4.1: Calculate Drag Torque**

```typescript
// Aerodynamic drag opposes rotation, grows with yaw rate squared
const yawDragCoeff = 0.8;  // Tunable for arcade feel

// Drag torque (sign preserves direction, magnitude is quadratic)
const dragTorque = -yawDragCoeff * state.yawRate * Math.abs(state.yawRate);

// Convert to yaw acceleration
const yawAcc_drag = dragTorque / config.inertia;
```

**Step 4.2: Apply Alongside Tire-Generated Yaw**

```typescript
// Yaw from tires (existing)
const yawAcc_tires = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;

// Total yaw acceleration
const yawAcc = yawAcc_tires + yawAcc_drag;

state.yawRate += yawAcc * dt;
```

### Phase 5: Implement Handbrake as Friction State

**Step 5.1: Define Friction Coefficients**

```typescript
// In config
const tireGripCoefficient = 1.1;      // Peak grip (μ_peak), slightly above 1.0 for arcade
const tireSlideCoefficient = 0.4;     // Sliding friction (μ_slide) when locked
```

**Step 5.2: Apply Handbrake Friction Limit**

```typescript
// Rear friction coefficient
const rearFriction = input.handbrake > 0 ? config.tireSlideCoefficient : config.tireGripCoefficient;

// Calculate cornering force from stiffness
let Cr_stiffness = config.corneringStiffnessRear * rearLoad;
const Fyr_stiffness = -arcadeTireForce(alphaRear, config.slipAngleAtPeak, Cr_stiffness);

// Limit by friction
const maxFriction = rearFriction * rearLoad * config.mass * GRAVITY;
const Fyr = THREE.MathUtils.clamp(Fyr_stiffness, -maxFriction, maxFriction);
```

**Step 5.3: Remove Old Handbrake Scaling**

Delete:
```typescript
const handbrakeRearScale = input.handbrake > 0 ? config.handbrakeRearScale : 1;
```

Remove config:
- `handbrakeRearScale`

### Phase 6: Tune Tire Model for Arcade Feel

**Step 6.1: Adjust Peak Slip Angle**

Current: 22-35° (from earlier changes)

For arcade drift controllability:
```typescript
const slipAngleAtPeak = THREE.MathUtils.degToRad(28 + driftFactor * 10);
// Range: 28° to 38° (higher = more drift range before falloff)
```

**Step 6.2: Adjust Falloff Rate**

Current in tire model:
```typescript
factor = 1.0 / (1.0 + 0.20 * (normalizedSlip - 1.0));
```

For more catchable drifts:
```typescript
const falloffRate = 0.15;  // Slower falloff (was 0.20)
factor = 1.0 / (1.0 + falloffRate * (normalizedSlip - 1.0));
```

At 2x peak slip: 87% force (was 83%)
At 3x peak slip: 77% force (was 71%)

More force at high slip = easier to catch with counter-steering.

### Phase 7: Tune Grip Balance for Drift Feel

**Step 7.1: Set Base Cornering Stiffness**

Start conservative:
```typescript
const corneringStiffnessFront = 16000;
const corneringStiffnessRear = 13000;
// Ratio: 1.23:1 (front biased for stability)
```

**Step 7.2: Set Friction Coefficients**

```typescript
const tireGripCoefficient = 1.1;     // Normal grip
const tireSlideCoefficient = 0.38;   // Locked wheels
// With handbrake: ~2.9x grip reduction
```

**Step 7.3: Exaggerate Weight Transfer (Arcade Feel)**

```typescript
const heightCG = 0.65;  // Exaggerated (real ~0.50m)
// More weight shift = more dynamic feel
```

**Step 7.4: Tune Self-Aligning Torque**

```typescript
const pneumaticTrail = 0.035;     // Exaggerated for feel
const steeringDamping = 4.0;      // Stronger for stability
const steeringInertia = 0.06;     // Light for responsiveness
```

**Step 7.5: Tune Aerodynamic Drag**

```typescript
const yawDragCoeff = 1.2;  // Higher for more stabilization
```

---

## Expected Behavior After Redesign

### Drift Initiation
1. Turn + handbrake
2. Rear friction drops to 0.38 (sliding)
3. Weight shifts forward (braking acceleration)
4. Rear load decreases, rear grip = `13000 * 0.6 * 0.38 = ~3,000`
5. Front grip = `16000 * 1.2 = ~19,000`
6. Ratio: ~6:1 → car begins rotating from torque imbalance

### Drift Maintenance
1. Release handbrake
2. Rear friction returns to 1.1
3. Apply throttle → acceleration shifts weight rearward
4. Rear load increases: `rearLoad = 0.6 + weightTransfer`
5. More throttle = more rear grip = less rotation
6. Player modulates throttle to control drift angle

### Drift Catch
1. Counter-steer into slide
2. Front tires develop opposite slip angle
3. Front forces create counter-rotation torque
4. Large slip angles (40-50°) still have 77% force (falloffRate = 0.15)
5. Counter-steering is effective
6. Reduce throttle → rear unloads → helps catch

### Steering Feel
1. Release steering input
2. Self-aligning torque returns wheel toward center
3. Player can feel forces through steering resistance
4. Natural centering, not artificial "hold position"

### No Oscillations
1. All systems work together (no conflicts)
2. Front forces stabilize smoothly (no overshoot)
3. Weight transfer consistent (single calculation)
4. Aerodynamic drag naturally damps high yaw rates

### Consistent Behavior
1. No speed-based grip scaling → same feel at all speeds
2. Same input always gives same output
3. Players can learn: "This is how my car behaves"
4. Skill-based: master throttle/steering modulation

---

## Testing & Validation Plan

### Test 1: Drift Initiation at Various Speeds
**Test:** Turn + handbrake at 50, 80, 110 km/h
**Expected:** Consistent initiation behavior at all speeds (no magic speed scaling)
**Validate:** Check telemetry Cf/Cr ratios are consistent

### Test 2: Throttle Modulation
**Test:** Initiate drift, apply 0%, 50%, 100% throttle
**Expected:**
- 0% throttle: large drift angle (rear unloaded)
- 50% throttle: moderate angle (balanced)
- 100% throttle: small angle (rear loaded)
**Validate:** Drift angle should be controllable and progressive

### Test 3: Counter-Steering Effectiveness
**Test:** Over-rotate, apply full counter-steer
**Expected:** Can always catch slide (no spinouts from "too far gone")
**Validate:** High slip angles still generate 75%+ force

### Test 4: No Oscillations
**Test:** Hold constant steering during turn
**Expected:** Smooth yaw rate curve, no oscillation
**Validate:** Plot yawRate over time, should be smooth

### Test 5: Steering Return
**Test:** Turn wheel, release input
**Expected:** Wheel returns to center naturally (not instantly)
**Validate:** Self-aligning torque feels natural, not artificial

### Test 6: No Artificial Corrections
**Test:** Release all inputs mid-drift
**Expected:** Car maintains state, physics alone determines outcome
**Validate:** No position push, no auto counter-steer, no magical grip changes

---

## Rollback Plan

If redesign makes things worse:

**Checkpoint 1:** Before starting, commit current state
```bash
git add .
git commit -m "checkpoint: before clean-sheet physics redesign"
```

**Checkpoint 2:** After each phase, test and commit
```bash
git commit -m "phase 1: removed artificial systems"
git commit -m "phase 2: unified weight transfer"
# etc.
```

**Rollback:** If any phase breaks things
```bash
git reset --hard <checkpoint-commit>
```

**Incremental Testing:** Don't implement all phases at once. Test after each phase.

---

## Success Criteria

**Must Have:**
- ✓ No oscillations during constant steering input
- ✓ Drift initiation works at all speeds (consistent)
- ✓ Throttle modulates drift angle (not prevents it)
- ✓ Counter-steering catches slides reliably
- ✓ No "artificial" feeling (physics rules are learnable)

**Nice to Have:**
- ✓ Steering feel communicates forces
- ✓ Progressive grip breakaway (not instant)
- ✓ Exaggerated but believable behavior
- ✓ Satisfying weight transfer sensation

**Deal Breakers:**
- ✗ Car spins uncontrollably
- ✗ Can't initiate drifts reliably
- ✗ Behavior still unpredictable
- ✗ Still feels like systems fighting each other

---

## Timeline Estimate

**Phase 1 (Remove artificial):** 30 min
**Phase 2 (Unified weight transfer):** 45 min
**Phase 3 (Self-aligning torque):** 60 min
**Phase 4 (Aerodynamic drag):** 15 min
**Phase 5 (Handbrake friction):** 30 min
**Phase 6 (Tire model tuning):** 15 min
**Phase 7 (Parameter tuning):** 30 min

**Total Implementation:** ~4 hours

**Testing & Iteration:** 2-4 hours

**Total:** 6-8 hours for complete clean-sheet redesign

---

## Alternative: Minimal Fix vs Clean Sheet

If clean sheet seems too risky, we could do minimal targeted fixes:

**Minimal Fix Option:**
1. Remove speed-based grip scaling only
2. Fix weight transfer throttle coefficient (0.25 → 0.10)
3. Tune front/rear balance better
4. Keep everything else

**Trade-off:**
- ✓ Faster (1 hour)
- ✓ Lower risk
- ✗ Still has artificial elements
- ✗ May still have subtle issues
- ✗ Doesn't address root cause

**Recommendation:** Clean sheet is better for long-term. Builds proper foundation for future features (AWD, different car types, tire wear, etc.)

---

## Next Steps

1. **Review this plan** with user and other agent
2. **Get approval** for clean sheet vs minimal fix
3. **Create checkpoint commit** before starting
4. **Implement phase by phase** with testing between each
5. **Iterate on tuning** until drift feel is right
6. **Document final parameters** for future reference

---

## Questions for User/Other Agent

1. **Clean sheet vs minimal fix?** Is 6-8 hours of work worth it for proper foundation?
2. **Arcade feel priority?** Should we optimize for easy/forgiving or challenging/realistic?
3. **Testing approach?** Want to test after each phase, or all phases then test?
4. **Parameter exposure?** Should final params be exposed for runtime tuning (sliders)?
5. **Rollback threshold?** At what point do we abandon clean sheet and rollback?
