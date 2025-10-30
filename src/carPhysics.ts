import * as THREE from 'three';
import { TrackSurface } from './track';
import type { InputSnapshot } from './input';

const GRAVITY = 9.81;

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface CarSpec {
  driftControl: number;
  power: number;
}

export interface CarConfig {
  // Physical properties
  mass: number;
  inertia: number;
  cgToFrontAxle: number;
  cgToRearAxle: number;
  heightCG: number;  // Center of gravity height for weight transfer
  driftThresholdSlip?: number;  // NEW: Dynamic drift sensitivity from feel panel

  // Tire properties
  corneringStiffnessFront: number;
  corneringStiffnessRear: number;
  slipAngleAtPeak: number;
  tireFalloffRate: number;  // NEW: Arcade tuning for catchability
  tireGripCoefficient: number;  // NEW: μ_peak (arcade boosted)
  tireSlideCoefficient: number;  // NEW: μ_slide (locked wheels)

  // Engine & braking
  engineForce: number;
  brakeForce: number;
  handbrakeBrakeForce: number;
  dragCoefficient: number;
  rollingResistance: number;

  // Steering
  maxSteerAngle: number;
  steerRateLow: number;
  steerRateHigh: number;
  steerLowSpeedFactor: number;
  steerFullSpeed: number;
  highSpeedSteerLimit: number;

  // Drift detection
  minDriftSpeed: number;
  driftThresholdDeg: number;

  // Arcade assists
  angleHoldKp: number;  // NEW: Angle hold proportional gain
  angleHoldKd: number;  // NEW: Angle hold derivative gain
  counterSteerBoost: number;  // NEW: Counter-steer effectiveness boost
  handbrakeYawBoost: number;  // NEW: Initial D style yaw boost
  yawRateLimitGrip: number;  // NEW: Normal driving yaw limit
  yawRateLimitDrift: number;  // NEW: Drifting yaw limit
  yawDragCoeff: number;  // NEW: Aerodynamic drag coefficient

  // Input filtering
  steeringAttackRate: number;  // NEW: How fast steering responds
  steeringReleaseRate: number;  // NEW: How fast steering returns
  throttleRampUpRate: number;  // NEW: Throttle response
  throttleRampDownRate: number;  // NEW: Throttle release

  // Visual
  rideHeight: number;
  topSpeed: number;
}

export interface CarTelemetry {
  speed: number;
  slipAngleDeg: number;
  driftActive: boolean;
  driftStateName: string;  // NEW: For debugging
  assistStrength: number;  // NEW: For debugging
  score: number;
  gradePercent: number;
  driftTime: number;
  progress: number;
  lateralOffset: number;
  steerAngleDeg: number;
  yawRateDeg: number;
  steerInput: number;
  throttle: number;
  brake: number;
  handbrake: number;
  longitudinalSpeed: number;
  lateralSpeed: number;
  frontSlipDeg: number;
  rearSlipDeg: number;
}

// NEW: Drift mode state machine
const DriftState = {
  GRIP: 0,
  INITIATING: 1,
  DRIFTING: 2,
  RECOVERING: 3
} as const;

type DriftState = typeof DriftState[keyof typeof DriftState];

function getDriftStateName(state: DriftState): string {
  switch (state) {
    case DriftState.GRIP: return 'GRIP';
    case DriftState.INITIATING: return 'INITIATING';
    case DriftState.DRIFTING: return 'DRIFTING';
    case DriftState.RECOVERING: return 'RECOVERING';
    default: return 'UNKNOWN';
  }
}

// NEW: Input filtering state
interface InputFilterState {
  steerFiltered: number;
  throttleFiltered: number;
  brakeFiltered: number;
}

export interface CarState {
  position: THREE.Vector3;
  velocity: THREE.Vector2;
  yaw: number;
  yawRate: number;
  steerAngle: number;
  driftScore: number;
  driftTime: number;
  driftCombo: number;
  driftActive: boolean;
  slipAngle: number;
  gradePercent: number;
  progress: number;
  lateralOffset: number;
  lastProjection: ReturnType<TrackSurface['projectPoint']> | null;
  readonly config: CarConfig;

  // NEW: Drift mode state machine
  driftState: DriftState;
  driftTimer: number;
  angleAtEntry: number;
  assistStrength: number;

  // NEW: Input filtering
  inputFilter: InputFilterState;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function createCarState(track: TrackSurface, spec: CarSpec): CarState {
  const config = createCarConfig(spec);
  const startSample = track.getSampleAtDistance(0);
  const yaw = Math.atan2(startSample.tangent.z, startSample.tangent.x);
  const startPosition = startSample.position
    .clone()
    .addScaledVector(startSample.normal, config.rideHeight);

  return {
    position: startPosition,
    velocity: new THREE.Vector2(0, 0),
    yaw,
    yawRate: 0,
    steerAngle: 0,
    driftScore: 0,
    driftTime: 0,
    driftCombo: 0,
    driftActive: false,
    slipAngle: 0,
    gradePercent: startSample.tangent.y * 100,
    progress: startSample.distance,
    lateralOffset: 0,
    lastProjection: null,
    config,

    // NEW: Drift state machine
    driftState: DriftState.GRIP,
    driftTimer: 0,
    angleAtEntry: 0,
    assistStrength: 0,

    // NEW: Input filtering
    inputFilter: {
      steerFiltered: 0,
      throttleFiltered: 0,
      brakeFiltered: 0,
    },
  };
}

// ============================================================================
// TIRE MODEL - Arcade tuned for drift feel
// ============================================================================

/**
 * Arcade-style tire force model
 * Continuous curve with arcade-tuned falloff for catchability
 */
function arcadeTireForce(slipAngle: number, peakSlip: number, maxForce: number, falloffRate: number): number {
  const normalizedSlip = Math.abs(slipAngle) / peakSlip;

  let factor: number;
  if (normalizedSlip < 1.0) {
    // Before peak: smooth rise using cubic smoothstep
    const t = normalizedSlip;
    factor = t * t * (3 - 2 * t);
  } else {
    // After peak: slow falloff (arcade tuning for catchability)
    factor = 1.0 / (1.0 + falloffRate * (normalizedSlip - 1.0));
  }

  return maxForce * factor * Math.sign(slipAngle);
}

// ============================================================================
// INPUT FILTERING - Smooth keyboard inputs
// ============================================================================

function filterSteeringInput(
  state: InputFilterState,
  targetSteer: number,
  attackRate: number,
  releaseRate: number,
  dt: number
): number {
  const rate = targetSteer !== 0 ? attackRate : releaseRate;
  const steerDiff = targetSteer - state.steerFiltered;
  state.steerFiltered += steerDiff * rate * dt;
  state.steerFiltered = THREE.MathUtils.clamp(state.steerFiltered, -1, 1);
  return state.steerFiltered;
}

function filterThrottleBrake(
  current: number,
  target: number,
  rampUpRate: number,
  rampDownRate: number,
  dt: number
): number {
  const rate = target > current ? rampUpRate : rampDownRate;
  const diff = target - current;
  return THREE.MathUtils.clamp(current + diff * rate * dt, 0, 1);
}

// ============================================================================
// DRIFT MODE STATE MACHINE - Initial D style
// ============================================================================

function updateDriftMode(
  state: CarState,
  config: CarConfig,
  slipDeg: number,
  speedKmh: number,
  handbrake: number,
  dt: number
) {
  const driftThreshold = config.driftThresholdSlip ?? 22;  // Use feel panel value or default

  switch (state.driftState) {
    case DriftState.GRIP:
      // Only drift on handbrake OR very aggressive slip angle
      if (handbrake > 0.5 || (slipDeg > driftThreshold && speedKmh > 25)) {
        state.driftState = DriftState.INITIATING;
        state.angleAtEntry = state.yaw;
        state.assistStrength = 0;
      }
      break;

    case DriftState.INITIATING:
      state.assistStrength = Math.min(state.assistStrength + dt * 2.0, 1.0);
      if (slipDeg > 25 && handbrake < 0.5) {
        state.driftState = DriftState.DRIFTING;
        state.driftTimer = 0;
      } else if (slipDeg < 8 && handbrake < 0.5) {
        state.driftState = DriftState.GRIP;
      }
      break;

    case DriftState.DRIFTING:
      state.driftTimer += dt;
      if (slipDeg < 12) {
        state.driftState = DriftState.RECOVERING;
      }
      break;

    case DriftState.RECOVERING:
      state.assistStrength = Math.max(state.assistStrength - dt * 3.0, 0);
      if (slipDeg < 8 || state.assistStrength <= 0) {
        state.driftState = DriftState.GRIP;
      }
      break;
  }
}

// ============================================================================
// ARCADE ASSISTS - Initial D feel
// ============================================================================

/**
 * Drift angle hold assist - helps maintain drift angle
 */
function getDriftAngleHoldAssist(
  state: CarState,
  currentSlipDeg: number,
  targetSlipDeg: number,
  yawRateDeg: number
): number {
  if (state.driftState !== DriftState.DRIFTING) {
    return 0;
  }

  const slipError = targetSlipDeg - currentSlipDeg;
  const kP = state.config.angleHoldKp;
  const kD = state.config.angleHoldKd;

  const assistTorque = (kP * slipError - kD * yawRateDeg) * state.assistStrength;
  return assistTorque * THREE.MathUtils.degToRad(1);
}

/**
 * Counter-steer boost - helps catch over-rotation
 */
function getCounterSteerBoost(
  steerInput: number,
  slipAngleDeg: number,
  yawRateDeg: number,
  assistStrength: number,
  boostAmount: number
): number {
  const steerSign = Math.sign(steerInput);
  const slipSign = Math.sign(slipAngleDeg);
  const isCounterSteering = steerSign !== 0 && steerSign !== slipSign;
  const isOverRotating = Math.abs(yawRateDeg) > 60;

  if (isCounterSteering && isOverRotating) {
    return boostAmount * assistStrength;
  }

  return 0;
}

/**
 * Handbrake yaw boost - Initial D style dramatic entries
 */
function getHandbrakeYawBoost(
  handbrake: number,
  steerInput: number,
  speed: number,
  boostBase: number,
  dt: number
): number {
  if (handbrake < 0.5) {
    return 0;
  }

  const steerMagnitude = Math.abs(steerInput);
  const speedKmh = speed * 3.6;
  const speedFactor = THREE.MathUtils.smoothstep(speedKmh, 40, 100);
  const boostDirection = Math.sign(steerInput || 1);
  const boost = boostBase * steerMagnitude * speedFactor * handbrake;

  return boostDirection * boost * dt;
}

/**
 * Soft yaw rate limiter - prevents spinouts without hard clamping
 */
function applySoftYawLimit(
  yawRate: number,
  limit: number,
  dt: number
): number {
  const excess = Math.abs(yawRate) - limit;

  if (excess > 0) {
    const pullback = excess * 5.0 * dt;
    return yawRate - Math.sign(yawRate) * pullback;
  }

  return yawRate;
}

// ============================================================================
// MAIN PHYSICS STEP
// ============================================================================

export function stepCar(
  state: CarState,
  input: InputSnapshot,
  track: TrackSurface,
  dt: number,
  diagnosticMode?: boolean
): CarTelemetry {
  const config = state.config;

  // -------------------------------------------------------------------------
  // 1. TRACK PROJECTION & GRADE
  // -------------------------------------------------------------------------
  const projection = track.projectPoint(state.position);
  state.lastProjection = projection;
  const trackForward2d = new THREE.Vector2(projection.sample.tangent.x, projection.sample.tangent.z);
  if (trackForward2d.lengthSq() > 0) {
    trackForward2d.normalize();
  }
  const gradeSin = projection.sample.tangent.y;
  const forward2d = new THREE.Vector2(Math.cos(state.yaw), Math.sin(state.yaw));
  const right2d = new THREE.Vector2(-forward2d.y, forward2d.x);
  const alignment = trackForward2d.lengthSq() > 0 ? forward2d.dot(trackForward2d) : 0;
  const gradeAcceleration = -GRAVITY * gradeSin * THREE.MathUtils.clamp(alignment, -1, 1);

  // -------------------------------------------------------------------------
  // 2. INPUT FILTERING - Smooth keyboard inputs
  // -------------------------------------------------------------------------
  const steerInputRaw = THREE.MathUtils.clamp(input.steer, -1, 1);
  const steerInput = filterSteeringInput(
    state.inputFilter,
    steerInputRaw,
    config.steeringAttackRate,
    config.steeringReleaseRate,
    dt
  );

  const throttleInput = filterThrottleBrake(
    state.inputFilter.throttleFiltered,
    input.throttle,
    config.throttleRampUpRate,
    config.throttleRampDownRate,
    dt
  );
  state.inputFilter.throttleFiltered = throttleInput;

  const brakeInput = filterThrottleBrake(
    state.inputFilter.brakeFiltered,
    input.brake,
    config.throttleRampUpRate,
    config.throttleRampDownRate,
    dt
  );
  state.inputFilter.brakeFiltered = brakeInput;

  // Handbrake stays binary (instant response is correct)
  const handbrakeInput = input.handbrake;

  // -------------------------------------------------------------------------
  // 3. STEERING - Keyboard optimized
  // -------------------------------------------------------------------------
  const worldVelocity = state.velocity.clone();
  const speed = worldVelocity.length();
  let vLong = worldVelocity.dot(forward2d);
  let vLat = worldVelocity.dot(right2d);

  const steerSpeedFactor = THREE.MathUtils.clamp(speed / config.steerFullSpeed, 0, 1);
  const steerGain = THREE.MathUtils.lerp(config.steerLowSpeedFactor, 1, steerSpeedFactor);
  const highSpeedFactor = THREE.MathUtils.smoothstep(speed, config.steerFullSpeed * 0.5, config.steerFullSpeed * 1.6);
  const steerLimit = THREE.MathUtils.lerp(1, config.highSpeedSteerLimit, highSpeedFactor);
  const reverseSteerFlip = vLong < -0.5 ? -1 : 1;
  const steerRate = THREE.MathUtils.lerp(config.steerRateLow, config.steerRateHigh, steerSpeedFactor);
  const maxSteerDelta = steerRate * dt;

  // Hold steering position when neutral (correct for keyboard)
  if (Math.abs(steerInput) > 0.01) {
    // Apply steering strength multiplier (from feel panel)
    const steeringMultiplier = (config as any).steeringStrengthMultiplier ?? 1.0;
    const effectiveSteerInput = steerInput * steeringMultiplier;

    const targetSteerAngle = -effectiveSteerInput * config.maxSteerAngle * steerGain * steerLimit * reverseSteerFlip;
    const steerError = THREE.MathUtils.clamp(targetSteerAngle - state.steerAngle, -maxSteerDelta, maxSteerDelta);
    state.steerAngle += steerError;
  }

  // -------------------------------------------------------------------------
  // 4. CLEAN PHYSICS FOUNDATION - Unified weight transfer
  // -------------------------------------------------------------------------
  const wheelBase = config.cgToFrontAxle + config.cgToRearAxle;
  const baseLoadFront = config.cgToRearAxle / wheelBase;
  const baseLoadRear = config.cgToFrontAxle / wheelBase;

  // Calculate longitudinal forces
  const isStopped = Math.abs(vLong) < 1.5;
  const isReversing = vLong < -0.5;
  const wantsReverse = isStopped && brakeInput > 0 && throttleInput === 0;

  let engineForce = 0;
  let brakeForce = 0;

  if (wantsReverse || isReversing) {
    if (brakeInput > 0) {
      const reverseSpeed = Math.abs(vLong);
      const reverseTopSpeed = 10;
      engineForce = -brakeInput * config.engineForce * 0.6 *
        (1 - THREE.MathUtils.clamp(reverseSpeed / reverseTopSpeed, 0, 1));
    }
    if (throttleInput > 0 && isReversing) {
      brakeForce = Math.sign(vLong) * throttleInput * config.brakeForce;
    }
  } else {
    engineForce = throttleInput * config.engineForce *
      (1 - THREE.MathUtils.clamp(speed / config.topSpeed, 0, 1));
    brakeForce = Math.sign(vLong || 1) * brakeInput * config.brakeForce;
  }

  const dragging = config.dragCoefficient * vLong * Math.abs(vLong);
  const rolling = config.rollingResistance * Math.sign(vLong);
  const handbrakeForce = Math.sign(vLong || 1) * handbrakeInput * config.handbrakeBrakeForce;

  // UNIFIED WEIGHT TRANSFER from longitudinal acceleration
  const Flong = engineForce - dragging - rolling - brakeForce - handbrakeForce;
  const aLong = Flong / config.mass + gradeAcceleration;
  const weightTransfer = -(aLong * config.heightCG) / (wheelBase * GRAVITY);

  // Dynamic loads with exaggerated limits for arcade feel
  const frontLoad = THREE.MathUtils.clamp(baseLoadFront + weightTransfer, 0.4, 1.8);
  const rearLoad = THREE.MathUtils.clamp(baseLoadRear - weightTransfer, 0.3, 1.6);

  // -------------------------------------------------------------------------
  // 5. TIRE FORCES - With arcade friction coefficients
  // -------------------------------------------------------------------------
  // Minimal effectiveSpeed floor (just numerical stability)
  const effectiveSpeed = Math.max(Math.abs(vLong), 0.01);

  // Slip angles (geometric, pure physics)
  const alphaFront = Math.atan2(vLat + config.cgToFrontAxle * state.yawRate, effectiveSpeed) - state.steerAngle;
  const alphaRear = Math.atan2(vLat - config.cgToRearAxle * state.yawRate, effectiveSpeed);

  // Cornering forces from stiffness (sliders control the base values)
  let Cf = config.corneringStiffnessFront * frontLoad;
  let Cr = config.corneringStiffnessRear * rearLoad;

  // Handbrake: friction limit (not arbitrary multiplier)
  const rearFriction = handbrakeInput > 0.5 ? config.tireSlideCoefficient : config.tireGripCoefficient;
  const maxRearFriction = rearFriction * rearLoad * config.mass * GRAVITY;

  // Calculate tire forces
  const Fyf_stiffness = -arcadeTireForce(alphaFront, config.slipAngleAtPeak, Cf, config.tireFalloffRate);
  let Fyr_stiffness = -arcadeTireForce(alphaRear, config.slipAngleAtPeak, Cr, config.tireFalloffRate);

  // Limit rear by friction when handbrake
  if (handbrakeInput > 0.5) {
    Fyr_stiffness = THREE.MathUtils.clamp(Fyr_stiffness, -maxRearFriction, maxRearFriction);
  }

  // Counter-steer boost (arcade assist)
  const slipDeg = THREE.MathUtils.radToDeg(Math.abs(state.slipAngle));
  const yawRateDeg = THREE.MathUtils.radToDeg(state.yawRate);
  const counterSteerBoost = getCounterSteerBoost(
    steerInput,
    THREE.MathUtils.radToDeg(state.slipAngle),
    yawRateDeg,
    state.assistStrength,
    config.counterSteerBoost
  );

  const Fyf = Fyf_stiffness * (1 + counterSteerBoost);
  const Fyr = Fyr_stiffness;

  // -------------------------------------------------------------------------
  // 6. DYNAMICS - Pure bicycle model
  // -------------------------------------------------------------------------
  const ax = aLong;
  const ay = (Fyf + Fyr) / config.mass;

  // Proper bicycle model coupling (Coriolis/centripetal)
  const oldVLong = vLong;
  const oldVLat = vLat;
  vLong += (ax + state.yawRate * oldVLat) * dt;
  vLat += (ay - state.yawRate * oldVLong) * dt;

  // Yaw from tire forces
  let yawAcc = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;

  // Aerodynamic drag torque (hybrid linear + quadratic for effectiveness at all speeds)
  // Linear component works at low rotation, quadratic at high rotation
  const dragTorque = -config.yawDragCoeff * (
    state.yawRate * 3.0 +  // Linear: moderate damping (reduced from 8.0)
    state.yawRate * Math.abs(state.yawRate) * 1.0  // Quadratic: moderate at high yaw rates (reduced from 2.0)
  );
  const yawAcc_drag = dragTorque / config.inertia;
  yawAcc += yawAcc_drag;

  // Counter-steering snap-back prevention: extra damping when changing direction
  // Only activate during DRIFT counter-steering (high rotation), not when initiating turns
  const isCounterSteering = Math.sign(steerInput) !== Math.sign(state.yawRate) &&
                            Math.abs(steerInput) > 0.05 &&
                            Math.abs(yawRateDeg) > 25;  // Only at high rotation (drifting)
  let counterDamping = 0;
  if (isCounterSteering) {
    // Add extra damping to prevent over-rotation when counter-steering in a drift
    // Reduced from 2000 to 600 to match lower grip forces
    counterDamping = -state.yawRate * 600.0 / config.inertia;
    yawAcc += counterDamping;
  }

  // STABILITY ASSIST: Prevent accidental drifts during normal driving
  // Only allow car to rotate freely when handbrake is used or already drifting
  const isNormalDriving = handbrakeInput < 0.1 && state.driftState === DriftState.GRIP;
  let stabilityDamping = 0;
  if (isNormalDriving) {
    // Add EXTREMELY strong damping during normal driving to prevent accidental rotation
    // This makes tapping arrow keys just steer normally, not initiate drifts
    // Needs to be strong enough to counter physics yaw acceleration (which can be 40-50°/s²)
    stabilityDamping = -state.yawRate * 5000.0 / config.inertia;
    yawAcc += stabilityDamping;
  }

  state.yawRate += yawAcc * dt;

  // -------------------------------------------------------------------------
  // 7. ARCADE ASSISTS
  // -------------------------------------------------------------------------
  // Drift mode state machine
  const speedKmh = speed * 3.6;
  updateDriftMode(state, config, slipDeg, speedKmh, handbrakeInput, dt);

  // Drift angle hold assist
  const targetSlipDeg = 30;  // Simplified: could be calculated from inputs
  const angleHoldAssist = getDriftAngleHoldAssist(state, slipDeg, targetSlipDeg, yawRateDeg);
  state.yawRate += angleHoldAssist;

  // Handbrake yaw boost (Initial D drama)
  const handbrakeYaw = getHandbrakeYawBoost(
    handbrakeInput,
    steerInput,
    speed,
    config.handbrakeYawBoost,
    dt
  );
  state.yawRate += handbrakeYaw;

  // Soft yaw rate limiter
  const yawLimit = state.driftState === DriftState.GRIP
    ? config.yawRateLimitGrip
    : config.yawRateLimitDrift;
  const yawRateBeforeLimit = state.yawRate;
  state.yawRate = applySoftYawLimit(state.yawRate, yawLimit, dt);

  // DIAGNOSTIC LOGGING (only when inputs active)
  if (diagnosticMode && (Math.abs(steerInput) > 0.1 || Math.abs(handbrakeInput) > 0.1)) {
    const finalYawRateDeg = THREE.MathUtils.radToDeg(state.yawRate);
    console.group('🔬 PHYSICS STEP');
    console.log('📍 INPUTS:', {
      steer: steerInput.toFixed(3),
      steerFiltered: state.inputFilter.steerFiltered.toFixed(3),
      throttle: throttleInput.toFixed(2),
      handbrake: handbrakeInput.toFixed(2),
      steerAngle: THREE.MathUtils.radToDeg(state.steerAngle).toFixed(1) + '°'
    });
    console.log('⚡ SLIP ANGLES:', {
      front: THREE.MathUtils.radToDeg(alphaFront).toFixed(1) + '°',
      rear: THREE.MathUtils.radToDeg(alphaRear).toFixed(1) + '°',
      body: slipDeg.toFixed(1) + '°'
    });
    console.log('🔧 TIRE FORCES:', {
      frontForce: Fyf.toFixed(0) + 'N',
      rearForce: Fyr.toFixed(0) + 'N',
      frontGrip: Cf.toFixed(0),
      rearGrip: Cr.toFixed(0),
      ratio: (Cf/Cr).toFixed(2) + ':1'
    });
    console.log('🌀 YAW DYNAMICS:', {
      physicsYawAcc: (yawAcc * 180/Math.PI).toFixed(1) + '°/s²',
      dragDamping: (yawAcc_drag * 180/Math.PI).toFixed(1) + '°/s²',
      counterDamping: (counterDamping * 180/Math.PI).toFixed(1) + '°/s²',
      stabilityAssist: (stabilityDamping * 180/Math.PI).toFixed(1) + '°/s²',
      yawRate: yawRateDeg.toFixed(1) + '°/s'
    });
    console.log('🎮 ARCADE ASSISTS:', {
      angleHoldBoost: (angleHoldAssist * 180/Math.PI).toFixed(1) + '°/s',
      handbrakeBoost: (handbrakeYaw * 180/Math.PI).toFixed(1) + '°/s',
      counterSteerBoost: (counterSteerBoost * 100).toFixed(0) + '%',
      driftState: getDriftStateName(state.driftState),
      assistStrength: (state.assistStrength * 100).toFixed(0) + '%'
    });
    console.log('🚗 RESULT:', {
      finalYawRate: finalYawRateDeg.toFixed(1) + '°/s',
      wasLimited: Math.abs(yawRateBeforeLimit - state.yawRate) > 0.001,
      speed: speedKmh.toFixed(1) + ' km/h'
    });
    console.groupEnd();
  }

  // -------------------------------------------------------------------------
  // 8. INTEGRATION
  // -------------------------------------------------------------------------
  state.yaw += state.yawRate * dt;
  state.yaw = normalizeAngle(state.yaw);

  const newForward = new THREE.Vector2(Math.cos(state.yaw), Math.sin(state.yaw));
  const newRight = new THREE.Vector2(-newForward.y, newForward.x);
  const newVelocity = newForward.clone().multiplyScalar(vLong).add(newRight.multiplyScalar(vLat));

  state.velocity.copy(newVelocity);
  state.position.x += newVelocity.x * dt;
  state.position.z += newVelocity.y * dt;

  // -------------------------------------------------------------------------
  // 9. TRACK SURFACE CONSTRAINTS
  // -------------------------------------------------------------------------
  const updatedProjection = track.projectPoint(state.position);
  state.lastProjection = updatedProjection;
  const sampleNormal = updatedProjection.sample.normal.clone();
  const sampleBinormal = updatedProjection.sample.binormal.clone();

  const targetHeightPosition = updatedProjection.projected
    .clone()
    .addScaledVector(sampleNormal, config.rideHeight);
  const normalError = targetHeightPosition.sub(state.position).dot(sampleNormal);
  state.position.addScaledVector(sampleNormal, normalError);

  const lateralOffset = state.position.clone().sub(updatedProjection.projected).dot(sampleBinormal);
  const sampleWidth = updatedProjection.sample.width ?? 32;
  const clampLimit = Math.max(sampleWidth * 0.5 - 1.2, 0.2);
  const clampedLateral = THREE.MathUtils.clamp(lateralOffset, -clampLimit, clampLimit);
  const lateralBlend = clampedLateral - lateralOffset;
  if (lateralBlend !== 0) {
    state.position.addScaledVector(sampleBinormal, lateralBlend);
  }

  const correctedLateral = state.position.clone().sub(updatedProjection.projected).dot(sampleBinormal);
  state.lateralOffset = THREE.MathUtils.clamp(correctedLateral, -clampLimit, clampLimit);

  const finalTarget = updatedProjection.projected
    .clone()
    .addScaledVector(sampleNormal, config.rideHeight)
    .addScaledVector(sampleBinormal, state.lateralOffset);
  const finalHeightError = finalTarget.sub(state.position).dot(sampleNormal);
  state.position.addScaledVector(sampleNormal, finalHeightError);

  state.progress = updatedProjection.sample.distance;
  state.gradePercent = updatedProjection.sample.tangent.y * 100;
  state.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.1));

  // -------------------------------------------------------------------------
  // 10. DRIFT SCORING
  // -------------------------------------------------------------------------
  const driftThreshold = config.driftThresholdDeg;
  const driftSpeedOk = speed > config.minDriftSpeed;
  const driftActive = slipDeg > driftThreshold && driftSpeedOk;
  state.driftActive = driftActive;

  if (driftActive) {
    state.driftTime += dt;
    state.driftCombo = Math.min(state.driftCombo + dt, 5);
    let multiplier = 1;
    const absGrade = Math.abs(state.gradePercent);
    if (absGrade >= 6) multiplier = 1.5;
    if (absGrade >= 10) multiplier = 2;
    const comboMultiplier = 1 + state.driftCombo * 0.15;
    state.driftScore += dt * multiplier * comboMultiplier;
  } else {
    state.driftTime = Math.max(0, state.driftTime - dt * 2);
    state.driftCombo = Math.max(0, state.driftCombo - dt * 3);
  }

  // -------------------------------------------------------------------------
  // 11. TELEMETRY
  // -------------------------------------------------------------------------
  const driftStateNames = ['GRIP', 'INITIATING', 'DRIFTING', 'RECOVERING'];

  return {
    speed,
    slipAngleDeg: THREE.MathUtils.radToDeg(state.slipAngle),
    driftActive,
    driftStateName: driftStateNames[state.driftState],
    assistStrength: state.assistStrength,
    score: state.driftScore,
    gradePercent: state.gradePercent,
    driftTime: state.driftTime,
    progress: state.progress,
    lateralOffset: state.lateralOffset,
    steerAngleDeg: THREE.MathUtils.radToDeg(state.steerAngle),
    yawRateDeg,
    steerInput,
    throttle: throttleInput,
    brake: brakeInput,
    handbrake: handbrakeInput,
    longitudinalSpeed: vLong,
    lateralSpeed: vLat,
    frontSlipDeg: THREE.MathUtils.radToDeg(alphaFront),
    rearSlipDeg: THREE.MathUtils.radToDeg(alphaRear),
  };
}

// ============================================================================
// CONFIGURATION - Arcade tuned for Initial D feel
// ============================================================================

function createCarConfig(spec: CarSpec): CarConfig {
  const driftLevel = THREE.MathUtils.clamp(spec.driftControl, 1, 5);
  const driftFactor = driftLevel / 5;
  const powerLevel = THREE.MathUtils.clamp(spec.power, 1, 3);

  const wheelBase = 2.54;
  const cgToFrontAxle = 1.08;
  const cgToRearAxle = wheelBase - cgToFrontAxle;

  // Arcade cornering stiffness - REDUCED for smoother, less violent physics
  const corneringStiffnessFront = 8000 + driftFactor * 4000;   // Was 22000, reduced by 64%
  const corneringStiffnessRear = 6000 + driftFactor * 3000;     // Was 18000, reduced by 67%

  // Arcade tire parameters
  const slipAngleAtPeak = THREE.MathUtils.degToRad(32 + driftFactor * 10);  // 32-42°
  const tireFalloffRate = 0.12;  // Slow falloff for catchability

  return {
    // Physical properties
    mass: 1220,
    inertia: 1320,
    cgToFrontAxle,
    cgToRearAxle,
    heightCG: 0.52,  // Reduced - was too high causing excessive weight transfer

    // Tire properties
    corneringStiffnessFront,
    corneringStiffnessRear,
    slipAngleAtPeak,
    tireFalloffRate,
    tireGripCoefficient: 1.55,  // Arcade boosted for responsive grip (real ~1.0)
    tireSlideCoefficient: 0.32,  // Locked wheels friction

    // Engine & braking
    engineForce: 5200 + powerLevel * 2100,
    brakeForce: 9200,
    handbrakeBrakeForce: 800,  // Light braking, mainly for weight shift
    dragCoefficient: 0.52,
    rollingResistance: 90,

    // Steering
    maxSteerAngle: THREE.MathUtils.degToRad(32),
    steerRateLow: THREE.MathUtils.degToRad(100),
    steerRateHigh: THREE.MathUtils.degToRad(120),  // Fast for keyboard
    steerLowSpeedFactor: 0.42,
    steerFullSpeed: 30,
    highSpeedSteerLimit: 0.80,

    // Drift detection
    minDriftSpeed: 9,
    driftThresholdDeg: 30,
    driftThresholdSlip: 22,  // Initial value, controlled by feel panel

    // Arcade assists (Initial D tuning)
    angleHoldKp: 0.08,
    angleHoldKd: 0.02,
    counterSteerBoost: 0.25,
    handbrakeYawBoost: THREE.MathUtils.degToRad(180),  // 180 deg/s base
    yawRateLimitGrip: THREE.MathUtils.degToRad(120),
    yawRateLimitDrift: THREE.MathUtils.degToRad(200),
    yawDragCoeff: 60.0,  // Moderate damping (reduced from 200 to match lower grip)

    // Input filtering (keyboard smoothing)
    steeringAttackRate: 8.0,
    steeringReleaseRate: 4.0,
    throttleRampUpRate: 6.0,
    throttleRampDownRate: 8.0,

    // Visual
    rideHeight: 0.72,
    topSpeed: 44 + powerLevel * 5,
  };
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
