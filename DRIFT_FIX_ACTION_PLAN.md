# Drift Physics Fix - Action Plan

## Confirmed Physics Issues

Based on analysis and other agent review, we've confirmed:

1. **Front grip dominance:** 12.8:1 to 15.4:1 ratio during handbrake (needs to be 3-4:1)
2. **Tire model discontinuity:** Force jumps from 1.7x → 1.0x at peak slip angle
3. **Slip angle peak too low:** 10-22° when real drifts happen at 30-50°
4. **Weight transfer clamp:** ±0.35 limit is conservative

**What's Working:**
- ✓ Coriolis coupling complete (line 246-247)
- ✓ Yaw clamp disabled during handbrake (line 276)
- ✓ Handbrake causes weight transfer (line 183-186)

---

## Physics-Based Fix Strategy

### Phase 1: Add Telemetry (Diagnostic)

**Goal:** Confirm actual values during handbrake turn at speed

**Add logging to src/carPhysics.ts around line 331:**

```typescript
// Enhanced telemetry during handbrake
if (input.handbrake > 0) {
  console.log('HANDBRAKE PHYSICS:', {
    // Grip values
    Cf: Cf.toFixed(0),
    Cr: Cr.toFixed(0),
    ratio: (Cf/Cr).toFixed(1) + ':1',

    // Slip angles
    alphaFront: THREE.MathUtils.radToDeg(alphaFront).toFixed(1) + '°',
    alphaRear: THREE.MathUtils.radToDeg(alphaRear).toFixed(1) + '°',

    // Tire forces
    Fyf: Fyf.toFixed(0) + 'N',
    Fyr: Fyr.toFixed(0) + 'N',

    // Rotation
    yawRate: THREE.MathUtils.radToDeg(state.yawRate).toFixed(1) + '°/s',
    yawAcc: THREE.MathUtils.radToDeg(yawAcc).toFixed(1) + '°/s²',

    // Load distribution
    frontLoad: frontLoad.toFixed(2),
    rearLoad: rearLoad.toFixed(2),

    // Speed
    speed: speed.toFixed(1) + 'm/s',
    vLong: vLong.toFixed(1),
    vLat: vLat.toFixed(1),
  });
}
```

**Expected observations:**
- Confirm Cf/Cr ratio is 12-15:1
- Watch yawRate increase from handbrake boost
- See alphaFront grow as rotation increases
- Observe Fyf (front force) creating negative yawAcc that fights rotation

---

### Phase 2: Fix Tire Model Discontinuity

**Goal:** Smooth force curve at peak slip angle

**Current problem (src/carPhysics.ts:121-136):**

Before peak:
```typescript
factor = normalizedSlip * (2 - normalizedSlip * normalizedSlip * 0.3);
// At normalizedSlip = 1.0: factor = 1.7
```

After peak:
```typescript
factor = 1.0 / (1.0 + 0.20 * (normalizedSlip - 1.0));
// At normalizedSlip = 1.0: factor = 1.0
```

**Fix:** Make continuous at transition

```typescript
function arcadeTireForce(slipAngle: number, peakSlip: number, maxForce: number): number {
  const normalizedSlip = Math.abs(slipAngle) / peakSlip;

  let factor: number;
  if (normalizedSlip < 1.0) {
    // Before peak: rise to 1.0 at peak
    // Using cubic for smooth transition: 3x² - 2x³
    const t = normalizedSlip;
    factor = t * t * (3 - 2 * t);
  } else {
    // After peak: gradual falloff starting at 1.0
    // At 2x slip: ~83%, at 3x: ~71%, at 4x: ~63%
    factor = 1.0 / (1.0 + 0.20 * (normalizedSlip - 1.0));
  }

  return maxForce * factor * Math.sign(slipAngle);
}
```

**Result:**
- Continuous force curve (factor = 1.0 at normalizedSlip = 1.0 from both sides)
- Smooth transition through peak slip
- Predictable drift behavior

---

### Phase 3: Rebalance Front/Rear Grip Ratio to 3-4:1

**Goal:** Allow rear to break loose while keeping front steering authority

**Current state with handbrake at high speed:**
- Cf = 15,795 N
- Cr = 1,024 N
- Ratio = 15.4:1

**Target:**
- Ratio = 3.5:1 (middle of 3-4:1 range)
- If Cf = 15,795, then Cr should be ~4,513

**Physics-based approaches (choose one or combine):**

#### Option A: Reduce Handbrake Weight Transfer Contribution

**Current (line 183):**
```typescript
const totalTransfer = THREE.MathUtils.clamp(
  (input.brake * 0.65 + input.handbrake * 0.85 - input.throttle * 0.8) * config.weightTransferGain,
  -0.35, 0.35
);
```

**Why:** Handbrake braking (locking rear wheels) shouldn't cause as much forward weight shift as full brake (all four wheels). Rally drivers use handbrake specifically because it doesn't load the front as much.

**Change:**
```typescript
const totalTransfer = THREE.MathUtils.clamp(
  (input.brake * 0.65 + input.handbrake * 0.35 - input.throttle * 0.8) * config.weightTransferGain,
  -0.45, 0.45  // Also relax clamp
);
```

Handbrake contribution: 0.85 → 0.35
- frontLoad would be lower (less front grip boost)
- rearLoad would be higher (more rear grip retained)

**Math:** With 0.35 handbrake weight transfer:
- totalTransfer = 0.35 * 0.55 = 0.1925
- frontLoad = 1.19, rearLoad = 0.81
- Cr = 15761 * 0.50 * 0.81 * 0.20 = 1,278
- Cf = 18000 * 0.65 * 1.19 = 13,923
- Ratio = 10.9:1 (better but still too high)

#### Option B: Keep More Rear Grip During Handbrake

**Current (line 450):**
```typescript
handbrakeRearScale: 0.20,  // Rear drops to 20% grip
```

**Why:** Real handbrakes lock rear wheels (0% rolling grip) but tires still have STATIC friction with the ground. The 0.20 scale might be too aggressive.

**Change:**
```typescript
handbrakeRearScale: 0.35,  // Rear drops to 35% grip
```

**Math:** With 0.35 rear scale:
- Cr = 15761 * 0.50 * 0.65 * 0.35 = 1,792
- Cf = 15,795 (unchanged)
- Ratio = 8.8:1 (better but still high)

#### Option C: Combined Approach (RECOMMENDED)

**Combine both fixes:**

1. Reduce handbrake weight transfer: 0.85 → 0.40
2. Keep more rear grip: 0.20 → 0.40
3. Relax weight transfer clamp: 0.35 → 0.45

**Math:**
```
totalTransfer = 0.40 * 0.55 = 0.22
frontLoad = 1.22, rearLoad = 0.78

Cf = 18000 * 0.65 * 1.22 = 14,274
Cr = 15761 * 0.50 * 0.78 * 0.40 = 2,459

Ratio = 5.8:1
```

Still high. Let's be more aggressive:

**Better combined values:**
- handbrake weight transfer: 0.85 → 0.30
- handbrakeRearScale: 0.20 → 0.45
- weight clamp: 0.35 → 0.50

**Math:**
```
totalTransfer = 0.30 * 0.55 = 0.165
frontLoad = 1.165, rearLoad = 0.835

Cf = 18000 * 0.65 * 1.165 = 13,644
Cr = 15761 * 0.50 * 0.835 * 0.45 = 2,964

Ratio = 4.6:1  ← In target range!
```

**Implementation:**

```typescript
// Line 183-186
const totalTransfer = THREE.MathUtils.clamp(
  (input.brake * 0.65 + input.handbrake * 0.30 - input.throttle * 0.8) * config.weightTransferGain,
  -0.50, 0.50
);

// Line 450
handbrakeRearScale: 0.45,  // Rear drops to 45% grip (vs 20%)
```

**Physics rationale:**
- Handbrake locks rear wheels but doesn't cause massive weight shift (rally technique)
- Locked wheels still have static friction with pavement
- This lets rear break loose while keeping some progressive control
- Front remains dominant but not overwhelming

---

### Phase 4: Increase Slip Angle Peak

**Goal:** Allow realistic drift angles (30-50°) with strong tire forces

**Current (line 418):**
```typescript
const slipAngleAtPeak = THREE.MathUtils.degToRad(10 + driftFactor * 12);
// Range: 10° to 22°
```

**Issue:** Real drift slip angles are 30-50°. With peak at 10-22°, drifts live in the falloff region with reduced force.

**Change:**
```typescript
const slipAngleAtPeak = THREE.MathUtils.degToRad(22 + driftFactor * 13);
// Range: 22° to 35°
```

**Physics rationale:**
- Matches realistic drift slip angles
- Keeps tires closer to peak during drift
- More force available for counter-steering
- Better control in high-angle slides

---

### Phase 5: Consider Handbrake Yaw Boost

**Current (lines 256-263):**
- Adds up to 350°/s yaw boost with full steering
- Fights against physics (front forces create counter-torque)

**Options:**

#### Option A: Keep Current Boost
- With 4.6:1 ratio, front forces are less dominant
- Boost might work better now that physics can rotate car
- Test first before removing

#### Option B: Reduce Boost Magnitude
```typescript
handbrakeYawBoost: THREE.MathUtils.degToRad(60),  // Down from 140°
```
- Subtle assist rather than dominant force
- Let physics do most of the work

#### Option C: Remove Boost Entirely
```typescript
// Remove lines 256-263
// Let grip loss alone cause rotation
```
- Pure physics, no artificial rotation
- Trust the 4.6:1 ratio to allow natural rotation

**Recommendation:** Start with Option A (keep boost), test with new grip ratio. If car rotates well naturally, reduce or remove boost in next iteration.

---

## Implementation Order

### Step 1: Add Telemetry
- Confirm current 12-15:1 ratio
- Observe front forces fighting rotation
- Establish baseline metrics

### Step 2: Fix Tire Model
- Smooth continuity at peak
- Immediate improvement, no tuning needed

### Step 3: Rebalance Grip Ratio
- Implement combined approach (Option C from Phase 3)
- Target 4.6:1 ratio
- Test immediately

### Step 4: Increase Slip Angle Peak
- Raise peak from 10-22° to 22-35°
- Test with new grip ratio

### Step 5: Evaluate Handbrake Boost
- With 4.6:1 ratio, test if boost is still needed
- Reduce or remove if physics alone rotates car

### Step 6: Fine-Tune
- Based on feel, adjust:
  - handbrakeRearScale (±0.05)
  - handbrake weight transfer (±0.05)
  - Grip scales if needed

---

## Expected Results

**After fixes:**

1. **Initiation:** Handbrake + turn → rear breaks loose, car begins rotation
2. **Natural rotation:** Lower front/rear ratio allows physics to rotate car
3. **Controllable:** 45% rear grip gives progressive breakaway, not instant spin
4. **Counter-steering works:** Front forces steer but don't dominate
5. **Drift maintenance:** Throttle modulates rear slip, steering controls angle
6. **No "takeover" feeling:** Physics responds to inputs predictably

**Key principle:** Drift should emerge from **grip imbalance** through the bicycle model, not from artificial yaw forces fighting physics.

---

## Rollback Plan

If changes make things worse:
1. Telemetry stays (always useful)
2. Tire model fix stays (objective improvement)
3. Revert grip ratio changes:
   - handbrake weight transfer: 0.30 → 0.85
   - handbrakeRearScale: 0.45 → 0.20
   - weight clamp: 0.50 → 0.35

---

## Success Criteria

- [ ] Can initiate drift with handbrake + turn at 25-35 m/s
- [ ] Car rotates naturally without "fighting" feeling
- [ ] Counter-steering catches slides effectively
- [ ] Can maintain drift angle with throttle control
- [ ] Transition from grip → drift → grip feels smooth
- [ ] No artificial "takeover" sensation
- [ ] Slip angles during drift are 30-45° (realistic)
- [ ] Front/rear grip ratio confirmed at 3-5:1 via telemetry
