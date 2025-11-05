# Clean-Sheet Arcade Drift Physics - Initial D Style for Keyboard

## Design Goal

**Foundation:** Pure physics (no speed scaling, no conflicts)
**Experience:** Initial D arcade feel (easy initiation, forgiving, satisfying)
**Input:** Keyboard-optimized (smooth binary inputs, smart assists)

---

## Initial D Reference Analysis

### What Makes Initial D Feel Good

1. **Easy Drift Initiation**
   - Handbrake → instant angle
   - Doesn't require perfect speed/angle/timing
   - Forgiving entry window

2. **Exaggerated Weight Transfer Feel**
   - Visible car body lean
   - Weight shift is dramatic and readable
   - Player feels connected to physics

3. **Drift Mode Assist**
   - Once drifting, game helps maintain it
   - Slight counter-steer assistance
   - "Drift lock" prevents sudden spinouts

4. **Progressive Catch**
   - Can always recover (no instant spinouts)
   - Large counter-steer margin
   - Mistakes are recoverable

5. **Throttle Control is Forgiving**
   - Throttle modulates angle smoothly
   - Not punishing (too much throttle ≠ instant spin)
   - Can "power through" slides

6. **Keyboard-Friendly**
   - Binary inputs feel smooth (filtering)
   - Don't need perfect timing
   - Digital inputs produce analog-like results

---

## Architecture: Physics Foundation + Arcade Assists

```
┌─────────────────────────────────────┐
│   Player Input (Keyboard)           │
│   - Binary steering (left/right)    │
│   - Binary throttle/brake           │
│   - Binary handbrake                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Input Filtering Layer              │
│   - Smooth binary → analog           │
│   - Steering rate limiting           │
│   - Deadzone handling                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Arcade Assist Layer                │
│   - Drift mode detection             │
│   - Counter-steer hint               │
│   - Yaw stabilization                │
│   - Angle hold assist                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Pure Physics Core                  │
│   - Bicycle model dynamics           │
│   - Tire forces (slip angles)        │
│   - Weight transfer (unified)        │
│   - No speed-based grip scaling      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Visual Feedback                    │
│   - Body roll animation              │
│   - Camera lag                       │
│   - Drift smoke/sparks               │
└─────────────────────────────────────┘
```

**Key Principle:** Physics is pure and consistent. Arcade feel comes from assists and presentation, NOT from physics hacks.

---

## Phase 1: Clean Physics Foundation (Same as Before)

### 1.1: Remove Speed-Based Grip Scaling

**Why:** Makes behavior consistent at all speeds. No magic changes.

```typescript
// DELETE
const frontGripScale = lerp(1, 0.58, highSpeedFactor);
const rearGripScale = lerp(1, 0.48, highSpeedFactor);

// REPLACE WITH
const frontGripScale = 1.0;
const rearGripScale = 1.0;
```

### 1.2: Unified Weight Transfer

**Why:** Single consistent formula. Throttle/brake affect weight through actual forces.

```typescript
// Calculate total longitudinal acceleration
const aLong = (engineForce - brakeForce - handbrakeForce - drag - rolling) / mass;

// Weight transfer from acceleration
const heightCG = 0.65;  // Exaggerated for arcade feel
const weightTransfer = -(aLong * heightCG) / (wheelBase * GRAVITY);

const frontLoad = baseLoadFront + weightTransfer;
const rearLoad = baseLoadRear - weightTransfer;

// Apply to grip
const Cf = corneringStiffnessFront * frontLoad;
const Cr = corneringStiffnessRear * rearLoad;
```

### 1.3: Constant Grip Ratios

**Why:** Predictable behavior. Player learns "my car has X grip."

```typescript
// Configuration
frontCorneringStiffness: 16000,
rearCorneringStiffness: 12000,
// Ratio: 1.33:1 normal, ~3-4:1 with handbrake

// Friction coefficients
tireGripCoefficient: 1.2,      // Arcade (above real 1.0)
tireSlideCoefficient: 0.35,    // Locked wheels
```

### 1.4: Remove effectiveSpeed Floor

```typescript
// Was: Math.max(Math.abs(vLong), 0.6)
// Now: Math.max(Math.abs(vLong), 0.01)  // Minimal for numerical stability
```

---

## Phase 2: Keyboard Input Filtering

### 2.1: Smooth Binary Steering

**Problem:** Keyboard gives instant -1 or +1, feels jerky.

**Solution:** Exponential smoothing filter.

```typescript
interface InputState {
  steerRaw: number;        // -1, 0, +1 from keyboard
  steerFiltered: number;   // Smoothed output
  steerVelocity: number;   // Rate of change
}

function filterSteering(state: InputState, targetSteer: number, dt: number): number {
  // Keyboard assist: smooth binary inputs to analog-like
  const attackRate = 8.0;   // How fast to turn in (fast for responsiveness)
  const releaseRate = 4.0;  // How fast to return (slower for control)

  const rate = targetSteer !== 0 ? attackRate : releaseRate;
  const steerDiff = targetSteer - state.steerFiltered;

  state.steerFiltered += steerDiff * rate * dt;
  state.steerFiltered = THREE.MathUtils.clamp(state.steerFiltered, -1, 1);

  return state.steerFiltered;
}
```

**Result:** Pressing left key → steering smoothly ramps to -1.0 over ~0.125s. Feels responsive but not jerky.

### 2.2: Throttle/Brake Smoothing

**Problem:** Binary throttle causes sudden weight transfer jerks.

**Solution:** Smooth ramp up/down.

```typescript
function filterThrottle(current: number, target: number, dt: number): number {
  const rampUpRate = 6.0;    // Fast response when pressing
  const rampDownRate = 8.0;  // Faster release (like lifting foot)

  const rate = target > current ? rampUpRate : rampDownRate;
  const diff = target - current;

  return current + diff * rate * dt;
}
```

### 2.3: Handbrake: Keep Binary

**Why:** Handbrake SHOULD be instant (like pulling lever). This is correct.

```typescript
// No filtering on handbrake - instant on/off is desired
const handbrakeInput = keys.has('Space') ? 1 : 0;
```

---

## Phase 3: Drift Mode Detection & Assists

### 3.1: Drift Mode State Machine

**States:**
- `GRIP`: Normal driving
- `INITIATING`: Handbrake pressed or large slip angle building
- `DRIFTING`: Sustained drift (slip > 15°, speed > 20 km/h)
- `RECOVERING`: Straightening out

```typescript
enum DriftState {
  GRIP,
  INITIATING,
  DRIFTING,
  RECOVERING
}

interface DriftModeState {
  state: DriftState;
  driftTimer: number;      // How long in drift
  angleAtEntry: number;    // Car angle when drift started
  assistStrength: number;  // 0-1, ramps up during drift
}

function updateDriftMode(state: DriftModeState, telemetry: CarTelemetry, dt: number) {
  const slipDeg = Math.abs(telemetry.slipAngleDeg);
  const speedKmh = telemetry.speed * 3.6;
  const handbrake = telemetry.handbrake > 0.5;

  switch (state.state) {
    case DriftState.GRIP:
      if (handbrake || (slipDeg > 12 && speedKmh > 20)) {
        state.state = DriftState.INITIATING;
        state.angleAtEntry = telemetry.yawAngleDeg;
        state.assistStrength = 0;
      }
      break;

    case DriftState.INITIATING:
      state.assistStrength = Math.min(state.assistStrength + dt * 2.0, 1.0);
      if (slipDeg > 20 && !handbrake) {
        state.state = DriftState.DRIFTING;
        state.driftTimer = 0;
      } else if (slipDeg < 5 && !handbrake) {
        state.state = DriftState.GRIP;
      }
      break;

    case DriftState.DRIFTING:
      state.driftTimer += dt;
      if (slipDeg < 8) {
        state.state = DriftState.RECOVERING;
      }
      break;

    case DriftState.RECOVERING:
      state.assistStrength = Math.max(state.assistStrength - dt * 3.0, 0);
      if (slipDeg < 5 || state.assistStrength <= 0) {
        state.state = DriftState.GRIP;
      }
      break;
  }
}
```

### 3.2: Drift Angle Hold Assist (Initial D Style)

**What:** When drifting, subtle yaw force helps maintain target angle.

**Why:** Makes drifting easier to hold. Forgiving for keyboard.

```typescript
function getDriftAngleHoldAssist(
  state: DriftModeState,
  currentSlipDeg: number,
  targetSlipDeg: number,
  yawRate: number
): number {
  if (state.state !== DriftState.DRIFTING) {
    return 0;
  }

  // Target slip angle (what player seems to want based on inputs)
  // This could be calculated from steering + throttle position

  const slipError = targetSlipDeg - currentSlipDeg;

  // PID controller for slip angle
  const kP = 0.08;  // Proportional gain
  const kD = 0.02;  // Derivative gain (damping)

  const assistTorque = (kP * slipError - kD * yawRate) * state.assistStrength;

  // Convert to yaw acceleration boost
  const assistYawAcc = assistTorque * THREE.MathUtils.degToRad(1);

  return assistYawAcc;
}
```

**Result:** If you're drifting at 25° and the game thinks you want 30°, it gently adds yaw to help. Very subtle, just smooths out control.

### 3.3: Counter-Steer Hint

**What:** When over-rotating, slight boost to counter-steer effectiveness.

**Why:** Keyboard players can't modulate steering analog. This compensates.

```typescript
function getCounterSteerAssist(
  steerInput: number,      // -1 to 1
  slipAngleDeg: number,    // Car slip
  yawRateDeg: number,      // Rotation rate
  assistStrength: number   // 0-1 from drift mode
): number {
  // Detect if steering is opposite to slip (counter-steering)
  const steerSign = Math.sign(steerInput);
  const slipSign = Math.sign(slipAngleDeg);

  const isCounterSteering = steerSign !== 0 && steerSign !== slipSign;

  if (!isCounterSteering) {
    return 0;
  }

  // Over-rotation detection
  const isOverRotating = Math.abs(yawRateDeg) > 60;

  if (isOverRotating) {
    // Boost counter-steer by 25% when over-rotating
    const boost = 0.25 * assistStrength;
    return boost;
  }

  return 0;
}

// Apply in tire force calculation
const counterSteerBoost = getCounterSteerAssist(...);
const Cf_boosted = Cf * (1 + counterSteerBoost);
```

**Result:** When spinning too fast and you counter-steer, front tires get slight boost. Easier to catch slides.

### 3.4: Handbrake Yaw Boost (Initial D Style)

**What:** When handbrake + steering, add yaw boost to help initiation.

**Why:** Initial D has this. Makes entries easier and more dramatic.

```typescript
function getHandbrakeYawBoost(
  handbrake: number,        // 0-1
  steerInput: number,       // -1 to 1
  speed: number,            // m/s
  dt: number
): number {
  if (handbrake < 0.5) {
    return 0;
  }

  // Boost scales with steering input (reward commitment)
  const steerMagnitude = Math.abs(steerInput);

  // Speed scaling: more effective at drift speeds (50-100 km/h)
  const speedKmh = speed * 3.6;
  const speedFactor = THREE.MathUtils.smoothstep(speedKmh, 40, 100);

  // Boost direction from steering
  const boostDirection = Math.sign(steerInput || 1);

  // Calculate boost (degrees per second)
  const baseBoost = 180;  // deg/s
  const boost = baseBoost * steerMagnitude * speedFactor * handbrake;

  return boostDirection * THREE.MathUtils.degToRad(boost) * dt;
}

// Apply to yaw rate
state.yawRate += getHandbrakeYawBoost(input.handbrake, input.steer, speed, dt);
```

**Result:** Handbrake + turn → dramatic rotation. Feels arcade and satisfying.

### 3.5: Yaw Rate Limiter (Prevents Spinouts)

**What:** Cap maximum yaw rate based on speed and drift state.

**Why:** Prevents uncontrollable spins. Initial D has this.

```typescript
function getYawRateLimit(
  driftState: DriftState,
  speed: number,          // m/s
  assistStrength: number  // 0-1
): number {
  const speedKmh = speed * 3.6;

  if (driftState === DriftState.GRIP) {
    // Normal driving: lower limit
    return THREE.MathUtils.degToRad(120);
  }

  // Drifting: higher limit, scales with speed
  const baseLimit = 200;  // deg/s at low speed
  const speedScale = THREE.MathUtils.lerp(1.0, 0.6, speedKmh / 120);

  return THREE.MathUtils.degToRad(baseLimit * speedScale);
}

// Apply SOFT limit (not hard clamp)
function applySoftYawLimit(yawRate: number, limit: number, dt: number): number {
  const excess = Math.abs(yawRate) - limit;

  if (excess > 0) {
    // Gradually pull back toward limit
    const pullback = excess * 5.0 * dt;  // Soft spring
    return yawRate - Math.sign(yawRate) * pullback;
  }

  return yawRate;
}
```

**Result:** Car can rotate fast, but won't spin uncontrollably. Catchable.

---

## Phase 4: Exaggerated Weight Transfer Feel

### 4.1: Increase Weight Transfer Coefficient

**Why:** Initial D has dramatic weight shift. Player should FEEL it.

```typescript
// In unified weight transfer calculation
const heightCG = 0.75;  // Exaggerated (real cars ~0.50m)

// This makes weight transfer more dramatic:
// - Braking: more forward weight (easier rear breakaway)
// - Throttle: more rearward weight (easier to power through)
```

### 4.2: Asymmetric Load Limits

**Why:** Allow more extreme weight distribution for arcade feel.

```typescript
const frontLoad = THREE.MathUtils.clamp(baseLoadFront + weightTransfer, 0.4, 1.8);
const rearLoad = THREE.MathUtils.clamp(baseLoadRear - weightTransfer, 0.3, 1.6);

// Was: 0.75-1.5 and 0.4-1.4
// Now: Allows more extreme shifts
```

---

## Phase 5: Tire Model Tuning for Arcade Feel

### 5.1: Increase Peak Slip Angle

**Why:** Drifts happen at larger angles (30-50°). Keep force strong there.

```typescript
const slipAngleAtPeak = THREE.MathUtils.degToRad(32 + driftFactor * 10);
// Range: 32° to 42° (higher than before)
```

### 5.2: Slower Falloff Rate

**Why:** Counter-steering at high angles needs to work. Keep force high.

```typescript
// In arcadeTireForce function
const falloffRate = 0.12;  // Was 0.15, now even slower

// At 2x peak (64-84°): 89% force
// At 3x peak: 81% force
```

**Result:** Can counter-steer even at extreme angles. Very forgiving.

### 5.3: Arcade Friction Coefficients

**Why:** Above-realistic grip for arcade feel.

```typescript
tireGripCoefficient: 1.3,      // Real ~1.0, arcade boosted
tireSlideCoefficient: 0.32,    // Locked wheels, very low
```

---

## Phase 6: Steering Feel for Keyboard

### 6.1: NO Self-Aligning Torque

**Why:** Self-aligning torque feels good on wheel (force feedback) but BAD on keyboard (laggy return).

**Solution:** Keep steering hold position when neutral (current behavior).

```typescript
// When steerInput == 0, steering holds angle
// This is CORRECT for keyboard despite being "unrealistic"
```

### 6.2: Fast Steering Response

**Why:** Keyboard needs responsive steering since you can't modulate.

```typescript
steerRateHigh: THREE.MathUtils.degToRad(120),  // Very fast (was 45)
```

---

## Phase 7: Visual & Audio Feedback (Future)

**Not in physics code, but important for arcade feel:**

1. **Body Roll Animation**
   - Visible car lean in corners
   - Exaggerated for weight transfer feedback

2. **Camera Lag**
   - Camera slightly delayed behind car rotation
   - Makes drifts feel more dramatic

3. **Drift Smoke**
   - Heavy smoke during drifts
   - Visual indicator of rear slip

4. **Tire Squeal Audio**
   - Pitch changes with slip angle
   - Audio feedback of grip state

5. **Rumble/Vibration**
   - Screen shake during aggressive drifts
   - Haptic feedback even on keyboard

---

## Complete Implementation Order

### Step 1: Input Filtering (30 min)
- Add InputState with filtered values
- Implement steering/throttle smoothing
- Test: binary inputs should feel smooth

### Step 2: Clean Physics Foundation (1 hour)
- Remove speed-based grip scaling
- Unified weight transfer
- Constant grip ratios
- Test: consistent behavior at all speeds

### Step 3: Drift Mode State Machine (30 min)
- Implement state detection
- Add drift timer and assist strength ramp
- Test: can detect drift entry/maintain/exit

### Step 4: Arcade Assists (1.5 hours)
- Angle hold assist
- Counter-steer boost
- Handbrake yaw boost
- Soft yaw limiter
- Test each assist individually

### Step 5: Exaggerated Weight Transfer (15 min)
- Increase heightCG
- Widen load limits
- Test: weight shift should be dramatic

### Step 6: Tire Model Tuning (30 min)
- Increase peak slip angles
- Slower falloff rate
- Arcade friction coefficients
- Test: drifts at 30-50° should work

### Step 7: Integration Testing (1 hour)
- Test complete flow: initiate → maintain → catch
- Verify assists work together (no conflicts)
- Tune assist strengths

### Step 8: Parameter Tuning (1-2 hours)
- Adjust assist gains based on feel
- Balance forgiveness vs challenge
- Iterate until Initial D feel achieved

**Total: 5-7 hours**

---

## Success Criteria: Initial D Feel

**Must Have:**
- ✓ Handbrake + turn → dramatic drift entry (yaw boost works)
- ✓ Keyboard inputs feel smooth (filtering works)
- ✓ Can maintain drift with throttle modulation (assists help)
- ✓ Counter-steering catches slides reliably (boost + slow falloff)
- ✓ No random spinouts (yaw limiter works)
- ✓ Consistent at all speeds (no speed-based grip scaling)

**Initial D Specific:**
- ✓ Exaggerated weight transfer (visible body roll when added)
- ✓ Easy initiation (low skill floor)
- ✓ Forgiving mistakes (recoverable)
- ✓ Satisfying feel (dramatic but controllable)

**Keyboard Specific:**
- ✓ Binary inputs don't feel jerky
- ✓ Can control drift angle with discrete throttle
- ✓ Don't need analog precision
- ✓ Fast steering response compensates for binary input

---

## Parameter Reference Sheet

**Physics Foundation:**
```typescript
frontCorneringStiffness: 16000
rearCorneringStiffness: 12000
tireGripCoefficient: 1.3
tireSlideCoefficient: 0.32
slipAngleAtPeak: 32-42°
tireFalloffRate: 0.12
heightCG: 0.75  // Exaggerated
```

**Input Filtering:**
```typescript
steeringAttackRate: 8.0
steeringReleaseRate: 4.0
throttleRampUp: 6.0
throttleRampDown: 8.0
```

**Arcade Assists:**
```typescript
angleHoldKp: 0.08
angleHoldKd: 0.02
counterSteerBoost: 0.25
handbrakeYawBoost: 180 deg/s
yawRateLimitGrip: 120 deg/s
yawRateLimitDrift: 200 deg/s
```

**Tunable by Feel:**
- All assist strengths (0-1 multipliers)
- Drift mode thresholds (slip angles)
- Weight transfer exaggeration (heightCG)
- Yaw boost magnitude

---

## Comparison: Clean Sheet vs This Plan

**Original Clean Sheet (Agent Criticism):**
- ✗ Pure physics bias
- ✗ Ignored keyboard
- ✗ No arcade assists
- ✗ Would feel "sim-lite"

**This Plan (Initial D Arcade):**
- ✓ Pure physics foundation (consistency)
- ✓ Keyboard-optimized filtering
- ✓ Initial D-style assists
- ✓ Targets arcade feel explicitly

**Key Difference:** This plan treats assists as FIRST-CLASS features, not afterthoughts.

---

## Next Steps

1. ✓ Get user approval for this revised plan
2. Implement phase by phase with testing
3. Tune assists for Initial D feel
4. Iterate based on feel testing
5. Add visual feedback (body roll, camera lag, smoke)

Ready to implement?
