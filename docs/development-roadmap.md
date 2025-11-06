# Drift Physics MVP - Implementation Plan

## Overview

Transform the current working cannon-es vehicle physics into a drift-capable system with realistic car dimensions, proper track sizing, and touge-style test courses.

## Phase 1: Real-World Scaling & Dimensions

### 1.1 Vehicle Dimensions (Reference: AE86 / 240SX)
**Current:** Generic 2m × 1m × 4m box

**Target:** Realistic drift car proportions
```typescript
// Based on Toyota AE86 / Nissan 240SX dimensions
Length: 4.2m (wheelbase ~2.4m)
Width: 1.7m (track width front/rear ~1.45m)
Height: 1.3m
Ground clearance: 0.15m
Wheel diameter: 0.65m (15-16 inch wheels)
Mass: 1100-1200kg (lightweight drift setup)
```

**Implementation:**
- Update chassis box: `new CANNON.Box(new CANNON.Vec3(0.85, 0.65, 2.1))`
- Update wheel positions to match realistic track width
- Adjust wheel radius to 0.325m (65cm diameter)
- Update suspension geometry for proper ride height

### 1.2 Track Dimensions
**Current:** 24m wide (too wide for touge)

**Target:** Realistic mountain pass
```typescript
Lane width: 3.0m per lane
Total road width: 6.5m (two narrow lanes)
Shoulder width: 0.5m per side
Total surface: 7.5m wide

For reference:
- Irohazaka (real touge): 6-7m wide
- Usui Pass: 5-6m wide
- Akina downhill: ~7m wide
```

**Implementation:**
- Update `track.ts`: `width: 7.5` (from 24)
- Adjust collision boxes accordingly
- Update road texture scale
- Tighten guardrail offset

### 1.3 Track Geometry Constraints
**Current:** Banking/camber follows Frenet frames (can be extreme)

**Target:** Mostly flat with gentle banking only on fast sweepers

```typescript
// Maximum banking angles (degrees)
Hairpins: 0° (flat)
Technical sections: 0-2° (nearly flat)
Fast sweepers: 2-5° (gentle banking)
Straights: 0° (flat)

// Camber (cross-slope for drainage)
Standard: 2-3° toward outside (realistic road drainage)
```

**Implementation:**
- Add banking limiter to track generation
- Override Frenet normal with custom banking calculation
- Clamp banking based on curvature radius
- Add camber parameter for drainage

---

## Phase 2: Test Track Creation

### 2.1 Touge Test Course Design

**Layout:** Classic touge sections for testing drift mechanics

```
Sector 1: Technical Entry (600m)
├─ Start straight (100m) - Acceleration test
├─ Medium-right entry (80m, R=50m) - Entry oversteer test
├─ Tight hairpin-left (120m, R=20m) - Low-speed drift test
├─ Short straight (80m) - Transition test
└─ S-curve left-right (220m) - Weight transfer test

Sector 2: Fast Sweeper (500m)
├─ Long right sweeper (300m, R=80m) - High-speed drift test
├─ Gentle banking 3-5° - Grip limit test
└─ Deceleration zone (200m) - Braking stability test

Sector 3: Downhill Technical (700m)
├─ Steep descent -8° - Weight forward test
├─ Double apex right (150m) - Line precision test
├─ Chicane left-right-left (200m) - Flick transition test
├─ Hairpin left (100m, R=18m) - Feint/clutch kick test
└─ Exit straight (250m) - Drift exit stability test

Total: ~1.8km focused test course
```

**Implementation:**
- Create `testTrack.ts` with precise control points
- Use tighter control point spacing (every 50m) for accuracy
- Add elevation profile separate from XZ curve
- Implement banking control per sector

### 2.2 Track Generator Improvements

```typescript
interface TrackConfig {
  // Dimensions
  width: number;              // 7.5m for touge
  laneCount: 2;

  // Banking control
  maxBankingAngle: number;    // 5° default
  bankingStyle: 'flat' | 'gentle' | 'racing';

  // Camber (cross-slope)
  camberAngle: number;        // 2° default (drainage)
  camberDirection: 'outside' | 'inside' | 'neutral';

  // Elevation
  maxGrade: number;           // 12° max (steep touge)
  minGrade: number;           // -12° max descent

  // Surface quality
  roughness: number;          // 0.0-1.0 (affects friction variation)
}
```

**Implementation:**
- Extend `TrackSurface` class with `TrackConfig`
- Add `calculateBanking(curvature, speed, style)` method
- Add `applyCamber(normal, direction, angle)` method
- Separate elevation profile from horizontal curve

---

## Phase 3: Drift Physics Implementation

### 3.1 Tire Model Enhancement

**Current:** Simple `frictionSlip: 5` parameter

**Target:** Slip-angle based tire model

```typescript
interface TireModel {
  // Grip characteristics
  peakSlipAngle: number;      // ~8-12° (angle of max grip)
  peakGripCoefficient: number; // 1.0-1.2 (dry asphalt)
  slideGripCoefficient: number; // 0.7-0.9 (when sliding)

  // Slip curve shape
  gripCurveShape: 'linear' | 'pacejka';
  transitionSmoothness: number; // 0-1 (grip->slide smoothness)

  // Load sensitivity
  loadSensitivity: number;     // How load affects grip (0.8-1.0)

  // Drift-specific
  driftGripMultiplier: number; // 0.85 (grip when drifting)
  counterSlideResponse: number; // How quickly tire regains grip
}
```

**Cannon-es Integration:**
```typescript
// Per-wheel friction calculation
wheel.frictionSlip = calculateDynamicFriction(
  slipAngle,      // From wheel velocity vs chassis velocity
  normalLoad,     // From suspension compression
  tireModel
);
```

**Implementation:**
- Calculate slip angle per wheel each frame
- Implement Pacejka-lite formula or lookup table
- Adjust `frictionSlip` dynamically based on slip angle
- Add load transfer calculation (weight distribution)

### 3.2 Drift Mechanics

**Core drift physics:**

```typescript
// 1. Weight Transfer
function calculateLoadTransfer(
  acceleration: Vector3,
  angularVelocity: number,
  chassisMass: number
): WheelLoads {
  // Longitudinal: braking/acceleration
  // Lateral: cornering forces
  // Distribute to 4 wheels
}

// 2. Slip Angle Calculation
function calculateSlipAngle(
  wheelVelocity: Vector3,
  wheelForward: Vector3
): number {
  // Angle between wheel direction and actual motion
  // Key metric for drift state
}

// 3. Drift State Detection
enum DriftState {
  GRIP = 'grip',           // < 5° slip, full grip
  TRANSITION = 'transition', // 5-15° slip, entering drift
  DRIFT = 'drift',         // > 15° slip, controlled slide
  SPIN = 'spin'            // > 45° slip, losing control
}

// 4. Countersteer Assistance (optional)
function calculateCountersteer(
  slipAngle: number,
  angularVelocity: number,
  userSteerInput: number
): number {
  // Subtle assist to help maintain drift angle
  // Can be disabled for hardcore mode
}
```

**Implementation:**
- Add drift state machine to vehicle update loop
- Calculate per-wheel slip angles from velocity vectors
- Implement load transfer from acceleration/rotation
- Add optional countersteer hint (visual aid, not forced input)

### 3.3 Vehicle Configuration for Drift

**Suspension Tuning:**
```typescript
// Stiffer rear for oversteer
front: {
  stiffness: 80,
  damping: 6.0,
  antiRollBar: 0.3
}
rear: {
  stiffness: 60,  // Softer for easier break-away
  damping: 5.0,
  antiRollBar: 0.2
}

// Weight distribution: 52/48 front/rear (FR layout)
centerOfMass: (0, -0.4, -0.2)  // Slightly rearward

// Differential (simulate with wheel coupling)
lockPercentage: 0.7  // 70% locked for drift
```

**Power Delivery:**
```typescript
// Realistic power curve
torqueCurve: {
  idle: 20 Nm,
  peak: 200 Nm @ 5500 RPM,
  redline: 7500 RPM
}

// Wheel power distribution
rearWheelDrive: true,
frontWheelDrive: false,
powerSplit: { front: 0, rear: 1.0 }
```

**Implementation:**
- Separate front/rear suspension configs
- Add differential simulation (couple rear wheel speeds)
- Implement power curve (map throttle to torque)
- Add engine braking effect

---

## Phase 4: MVP Feature Set

### 4.1 Core Features (Must-Have)

- [x] ✅ **Basic driving** - Working cannon-es vehicle
- [x] ✅ **Track collision** - Oriented boxes
- [x] ✅ **Camera** - Follow from behind
- [ ] **Realistic dimensions** - Proper car/road sizing
- [ ] **Test track** - 1.8km touge course
- [ ] **Flat banking** - Controlled camber system
- [ ] **Slip angle calculation** - Per-wheel slip detection
- [ ] **Dynamic friction** - Tire model based on slip
- [ ] **Drift state** - GRIP/TRANSITION/DRIFT/SPIN detection
- [ ] **Visual feedback** - Tire smoke, slip angle indicator
- [ ] **Audio feedback** - Engine, tire screech (placeholder)

### 4.2 Tuning Interface (Nice-to-Have)

```typescript
// Live tuning panel (keyboard shortcuts)
[1-9] - Suspension stiffness
[Q/W] - Tire grip levels
[A/S] - Differential lock
[Z/X] - Power curve

// Display
- Current slip angle (all 4 wheels)
- Drift state indicator
- Steering angle vs countersteer target
- Weight distribution (visual)
```

### 4.3 MVP Success Criteria

**The vehicle should be able to:**
1. ✅ Drive smoothly without bouncing/instability
2. ✅ Navigate the track without falling off
3. **Initiate drift** via weight transfer + throttle
4. **Maintain drift** through corner with throttle control
5. **Exit drift** smoothly without spinning
6. **Feel realistic** - not arcade, not simulation (middle ground)

**Performance targets:**
- Stable 60 FPS with drift physics enabled
- Predictable handling (small inputs = small changes)
- Recoverable mistakes (spin-outs are possible but avoidable)

---

## Phase 5: Implementation Order

### Week 1: Scaling & Track
1. ✅ **Day 1-2:** Update vehicle dimensions, wheel sizes
2. ✅ **Day 3:** Adjust track width to 7.5m, update textures
3. ✅ **Day 4-5:** Implement banking limiter and camber control
4. ✅ **Day 6-7:** Create test track layout with control points

### Week 2: Drift Physics Core
5. **Day 8-9:** Implement slip angle calculation per wheel
6. **Day 10-11:** Build tire model (Pacejka-lite or lookup table)
7. **Day 12-13:** Dynamic friction integration with cannon-es
8. **Day 14:** Test and tune grip->drift transition

### Week 3: Drift Mechanics
9. **Day 15-16:** Load transfer calculation (weight distribution)
10. **Day 17:** Drift state machine (GRIP/TRANSITION/DRIFT/SPIN)
11. **Day 18-19:** Vehicle configuration for drift (FR layout, LSD)
12. **Day 20-21:** Tuning and testing on test track

### Week 4: Polish & MVP
13. **Day 22-23:** Visual feedback (tire smoke particles, HUD)
14. **Day 24-25:** Audio placeholders (engine/tire sounds)
15. **Day 26-27:** Tuning interface for live adjustments
16. **Day 28:** Final testing, documentation, MVP release

---

## Technical Challenges & Solutions

### Challenge 1: Cannon-es Friction Limitation
**Problem:** `frictionSlip` is static per wheel, can't vary with slip angle

**Solution:**
- Update `frictionSlip` every frame based on calculated slip angle
- Use `vehicle.wheelInfos[i].frictionSlip = newValue`
- May need to call `vehicle.updateWheelTransform()` after changes

### Challenge 2: Load Transfer in Cannon-es
**Problem:** RaycastVehicle doesn't expose individual wheel loads

**Solution:**
- Approximate from suspension compression: `wheel.suspensionLength`
- When compressed → more load → more grip
- Scale friction by load: `baseFriction * (1 + loadFactor * compressionRatio)`

### Challenge 3: Banking Without Making Track Tilted
**Problem:** We want flat-feeling roads but need some banking for realism

**Solution:**
- Visual mesh: Slight banking for aesthetics (2-3°)
- Collision boxes: Flatten banking angle (multiply by 0.3)
- Result: Looks banked, feels mostly flat

### Challenge 4: Drift Feel vs Realism
**Problem:** Full sim = too hard, full arcade = no skill expression

**Solution:** Tuneable assists
```typescript
assists: {
  counterSteerHint: 0.3,     // Show suggested countersteer
  gripRecovery: 1.2,         // Faster grip return than real
  stabilityControl: 0.0,     // No electronic aids
  idealLineGhost: false      // Optional racing line
}
```

---

## Next Steps

1. **Review this plan** - Discuss priorities and timeline
2. **Implement Phase 1** - Start with real-world scaling
3. **Test track creation** - Build the 1.8km course
4. **Iterate on drift feel** - Most time will be spent here

**Estimated MVP completion:** 3-4 weeks of focused development

---

## References

- Real touge dimensions: Irohazaka, Usui Pass, Tsukuba
- Vehicle reference: AE86, 240SX, BRZ dimensions
- Tire physics: Pacejka Magic Formula (simplified)
- Drift technique: Weight transfer, clutch kick, feint entry
