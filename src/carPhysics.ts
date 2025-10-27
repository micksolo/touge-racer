import * as THREE from 'three';
import { TrackSurface } from './track';
import type { InputSnapshot } from './input';

const GRAVITY = 9.81;

export interface CarSpec {
  driftControl: number;
  power: number;
}

export interface CarConfig {
  mass: number;
  inertia: number;
  cgToFrontAxle: number;
  cgToRearAxle: number;
  corneringStiffnessFront: number;
  corneringStiffnessRear: number;
  slipAngleAtPeak: number;
  engineForce: number;
  brakeForce: number;
  handbrakeBrakeForce: number;
  dragCoefficient: number;
  rollingResistance: number;
  maxSteerAngle: number;
  rideHeight: number;
  topSpeed: number;
  minDriftSpeed: number;
  driftThresholdDeg: number;
  steerLowSpeedFactor: number;
  steerFullSpeed: number;
  yawLowSpeedFactor: number;
  steerRateLow: number;
  steerRateHigh: number;
  frontGripHighSpeedScale: number;
  rearGripHighSpeedScale: number;
  highSpeedSteerLimit: number;
  yawRateLimit: number;
  weightTransferGain: number;
  throttleOversteerStrength: number;
  handbrakeRearScale: number;
  handbrakeDrag: number;
  handbrakeYawBoost: number;
  throttleYawGain: number;
}

export interface CarTelemetry {
  speed: number;
  slipAngleDeg: number;
  driftActive: boolean;
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
  driftMode: boolean;
  driftModeTimer: number;
  slipAngle: number;
  gradePercent: number;
  progress: number;
  lateralOffset: number;
  lastProjection: ReturnType<TrackSurface['projectPoint']> | null;
  readonly config: CarConfig;
}

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
    driftMode: false,
    driftModeTimer: 0,
    slipAngle: 0,
    gradePercent: startSample.tangent.y * 100,
    progress: startSample.distance,
    lateralOffset: 0,
    lastProjection: null,
    config,
  };
}

/**
 * Arcade-style tire force model optimized for drift maintenance
 * Maintains high lateral force at large slip angles to sustain drifts
 */
function arcadeTireForce(slipAngle: number, peakSlip: number, maxForce: number): number {
  const normalizedSlip = Math.abs(slipAngle) / peakSlip;

  let factor: number;
  if (normalizedSlip < 1.0) {
    // Before peak: sharp rise with some non-linearity
    factor = normalizedSlip * (2 - normalizedSlip * normalizedSlip * 0.3);
  } else {
    // After peak: Gradual falloff to maintain control at high slip angles
    // At 2x slip: ~83% force, at 3x: ~71%, at 4x: ~63%
    // This lets counter-steering catch spinouts
    factor = 1.0 / (1.0 + 0.20 * (normalizedSlip - 1.0));
  }

  return maxForce * factor * Math.sign(slipAngle);
}

export function stepCar(
  state: CarState,
  input: InputSnapshot,
  track: TrackSurface,
  dt: number,
): CarTelemetry {
  const projection = track.projectPoint(state.position);
  state.lastProjection = projection;
  const trackForward2d = new THREE.Vector2(projection.sample.tangent.x, projection.sample.tangent.z);
  if (trackForward2d.lengthSq() > 0) {
    trackForward2d.normalize();
  }
  const gradeSin = projection.sample.tangent.y;

  const config = state.config;
  const forward2d = new THREE.Vector2(Math.cos(state.yaw), Math.sin(state.yaw));
  const right2d = new THREE.Vector2(-forward2d.y, forward2d.x);

  const alignment = trackForward2d.lengthSq() > 0 ? forward2d.dot(trackForward2d) : 0;
  const gradeAcceleration = -GRAVITY * gradeSin * THREE.MathUtils.clamp(alignment, -1, 1);

  const worldVelocity = state.velocity.clone();
  const speed = worldVelocity.length();
  let vLong = worldVelocity.dot(forward2d);
  let vLat = worldVelocity.dot(right2d);

  const steerInput = THREE.MathUtils.clamp(input.steer, -1, 1);
  const steerSpeedFactor = THREE.MathUtils.clamp(speed / config.steerFullSpeed, 0, 1);
  const steerGain = THREE.MathUtils.lerp(config.steerLowSpeedFactor, 1, steerSpeedFactor);
  const highSpeedFactor = THREE.MathUtils.smoothstep(speed, config.steerFullSpeed * 0.5, config.steerFullSpeed * 1.6);
  const steerLimit = THREE.MathUtils.lerp(1, config.highSpeedSteerLimit, highSpeedFactor);
  // Flip steering when going backwards (like a real car)
  const reverseSteerFlip = vLong < -0.5 ? -1 : 1;
  const targetSteerAngle = -steerInput * config.maxSteerAngle * steerGain * steerLimit * reverseSteerFlip;
  const steerRate = THREE.MathUtils.lerp(config.steerRateLow, config.steerRateHigh, steerSpeedFactor);
  const maxSteerDelta = steerRate * dt;
  const steerError = THREE.MathUtils.clamp(targetSteerAngle - state.steerAngle, -maxSteerDelta, maxSteerDelta);
  // REMOVED steering centering force AND amplification - direct 1:1 response
  state.steerAngle += steerError;

  const effectiveSpeed = Math.max(Math.abs(vLong), 0.6);
  // Handbrake only affects rear grip, not front - keeps steering functional
  const frontGripScale = THREE.MathUtils.lerp(1, config.frontGripHighSpeedScale, highSpeedFactor);
  const rearGripScale = THREE.MathUtils.lerp(1, config.rearGripHighSpeedScale, highSpeedFactor);
  const totalTransfer = THREE.MathUtils.clamp((input.brake * 0.65 - input.throttle * 0.8) * config.weightTransferGain, -0.35, 0.35);
  const frontLoad = THREE.MathUtils.clamp(1 + totalTransfer, 0.75, 1.5);
  const rearLoad = THREE.MathUtils.clamp(1 - totalTransfer, 0.4, 1.4);
  const lowSpeedBoost = THREE.MathUtils.clamp(1 - speed / 22, 0, 1);
  const handbrakeRearScale = input.handbrake > 0 ? config.handbrakeRearScale : 1;
  const Cf = config.corneringStiffnessFront * frontGripScale * frontLoad * (1 + 0.08 * lowSpeedBoost);

  // REMOVED throttle oversteer grip reduction - it was stacking with other multipliers and killing all rear grip
  // Natural oversteer comes from weight transfer (rearLoad) which is enough
  const Cr = config.corneringStiffnessRear * rearGripScale * rearLoad * handbrakeRearScale;

  const alphaFront = Math.atan2(vLat + config.cgToFrontAxle * state.yawRate, effectiveSpeed) - state.steerAngle;
  const alphaRear = Math.atan2(vLat - config.cgToRearAxle * state.yawRate, effectiveSpeed);

  const Fyf = -arcadeTireForce(alphaFront, config.slipAngleAtPeak, Cf);
  const Fyr = -arcadeTireForce(alphaRear, config.slipAngleAtPeak, Cr);

  // Reverse gear logic - when stopped and brake pressed, go reverse
  const isStopped = Math.abs(vLong) < 1.5; // Nearly stopped (1.5 m/s ~ 5 km/h)
  const isReversing = vLong < -0.5; // Moving backwards
  const wantsReverse = isStopped && input.brake > 0 && input.throttle === 0;

  let engineForce = 0;
  let brakeForce = 0;

  if (wantsReverse || isReversing) {
    // Reverse mode
    if (input.brake > 0) {
      // Brake pedal becomes reverse throttle
      const reverseSpeed = Math.abs(vLong);
      const reverseTopSpeed = 10; // Max reverse speed (10 m/s ~ 36 km/h)
      engineForce = -input.brake * config.engineForce * 0.6 *
        (1 - THREE.MathUtils.clamp(reverseSpeed / reverseTopSpeed, 0, 1));
    }
    // Throttle acts as brake when reversing
    if (input.throttle > 0 && isReversing) {
      brakeForce = Math.sign(vLong) * input.throttle * config.brakeForce;
    }
  } else {
    // Normal forward mode
    engineForce = Math.max(0, input.throttle) *
      config.engineForce *
      (1 - THREE.MathUtils.clamp(speed / config.topSpeed, 0, 1));
    brakeForce = Math.sign(vLong || 1) * Math.max(0, input.brake) * config.brakeForce;
  }

  const dragging = config.dragCoefficient * vLong * Math.abs(vLong);
  const rolling = config.rollingResistance * Math.sign(vLong);
  const handbrakeForce =
    Math.sign(vLong || 1) * Math.max(0, input.handbrake) * config.handbrakeBrakeForce;

  const ax =
    (engineForce - dragging - rolling - brakeForce - handbrakeForce) / config.mass + gradeAcceleration;
  const ay = (Fyf + Fyr) / config.mass;

  // CRITICAL FIX: Proper bicycle model coupling - yaw MUST induce lateral velocity for drifting
  // When rotating (yawRate) and moving forward (vLong), centripetal effect creates lateral motion
  const oldVLong = vLong;
  const oldVLat = vLat;

  vLong += (ax + state.yawRate * oldVLat) * dt;
  vLat += (ay - state.yawRate * oldVLong) * dt;

  const yawAcc = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;
  state.yawRate += yawAcc * dt;

  // Minimal damping (3%) to prevent numerical instability without killing drifts
  state.yawRate *= 1 - Math.min(dt * 0.03, 0.015);

  // HANDBRAKE: Apply boost BEFORE clamping so it can actually work
  if (input.handbrake > 0) {
    // Use steering input to determine handbrake yaw direction (if steering, else use existing yaw)
    const hbDir = steerInput !== 0 ? Math.sign(steerInput) : Math.sign(state.yawRate || 1);
    state.yawRate += hbDir * config.handbrakeYawBoost * input.handbrake * dt;
    const dragScale = Math.min(config.handbrakeDrag * input.handbrake * dt, 0.08);
    vLong *= 1 - dragScale;
  }

  // DRIFT ASSISTS: Very minimal assist only during handbrake to help initiation
  // Removed automatic throttle yaw assist - let physics handle oversteer naturally
  const isDrifting = state.driftMode || input.handbrake > 0 || Math.abs(state.slipAngle) > THREE.MathUtils.degToRad(8);

  // YAW CLAMP: Apply AFTER handbrake boost, with higher limits for drifting
  const yawLimit = isDrifting
    ? THREE.MathUtils.degToRad(150)  // Reasonable limit during drift for controllability
    : config.yawRateLimit;  // Normal driving uses config value (45°/s)
  state.yawRate = THREE.MathUtils.clamp(state.yawRate, -yawLimit, yawLimit);

  // REMOVED all drift stabilization - pure physics only
  // The tire model and player inputs handle everything

  state.yaw += state.yawRate * dt;
  state.yaw = normalizeAngle(state.yaw);

  const newForward = new THREE.Vector2(Math.cos(state.yaw), Math.sin(state.yaw));
  const newRight = new THREE.Vector2(-newForward.y, newForward.x);
  const newVelocity = newForward.clone().multiplyScalar(vLong).add(newRight.multiplyScalar(vLat));

  state.velocity.copy(newVelocity);
  state.position.x += newVelocity.x * dt;
  state.position.z += newVelocity.y * dt;

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
  const sampleWidth = updatedProjection.sample.width ?? track.width;
  const clampLimit = Math.max(sampleWidth * 0.5 - 1.2, 0.2);
  const clampedLateral = THREE.MathUtils.clamp(lateralOffset, -clampLimit, clampLimit);
  const lateralBlend = THREE.MathUtils.clamp(clampedLateral - lateralOffset, -0.45, 0.45);
  state.position.addScaledVector(sampleBinormal, lateralBlend);
  const correctedLateral = state.position.clone().sub(updatedProjection.projected).dot(sampleBinormal);
  state.lateralOffset = THREE.MathUtils.clamp(correctedLateral, -clampLimit, clampLimit);
  const finalTarget = updatedProjection.projected
    .clone()
    .addScaledVector(sampleNormal, config.rideHeight)
    .addScaledVector(sampleBinormal, state.lateralOffset);
  const finalHeightError = finalTarget.sub(state.position).dot(sampleNormal);
  state.position.addScaledVector(sampleNormal, finalHeightError);

  // Removed boundary velocity correction - it was preventing drifts by suppressing lateral velocity
  // Position is still clamped above (line 321), but velocity is free to slide

  state.progress = updatedProjection.sample.distance;
  state.gradePercent = updatedProjection.sample.tangent.y * 100;
  state.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.1));

  // Debug logging for drift mechanics (throttle every 30 frames ~0.5s)
  if (Math.random() < 0.033 && (input.handbrake > 0 || Math.abs(state.slipAngle) > THREE.MathUtils.degToRad(5))) {
    console.log('DRIFT DEBUG:', {
      vLat: vLat.toFixed(2),
      vLong: vLong.toFixed(2),
      yawRate: THREE.MathUtils.radToDeg(state.yawRate).toFixed(1) + '°/s',
      slipAngle: THREE.MathUtils.radToDeg(state.slipAngle).toFixed(1) + '°',
      alphaFront: THREE.MathUtils.radToDeg(alphaFront).toFixed(1) + '°',
      alphaRear: THREE.MathUtils.radToDeg(alphaRear).toFixed(1) + '°',
      handbrake: input.handbrake.toFixed(2),
    });
  }

  const driftThreshold = config.driftThresholdDeg;
  const slipDeg = THREE.MathUtils.radToDeg(Math.abs(state.slipAngle));
  const driftSpeedOk = speed > config.minDriftSpeed;
  const driftActive = slipDeg > driftThreshold && driftSpeedOk;
  state.driftActive = driftActive;

  // Drift mode management - enter drift mode with lower threshold for better control
  const driftModeThreshold = 8; // Enter drift mode at 8° (very easy to enter)
  const highSlipAngle = slipDeg > driftModeThreshold;
  const handbrakeEngaged = input.handbrake > 0.2;

  if ((highSlipAngle && driftSpeedOk) || (handbrakeEngaged && driftSpeedOk) || state.driftModeTimer > 0) {
    state.driftMode = true;
    state.driftModeTimer = Math.max(0, state.driftModeTimer - dt);

    // Extend drift mode while still sliding (long grace period for counter-steer time)
    if (highSlipAngle || handbrakeEngaged) {
      state.driftModeTimer = 1.0; // 1 second grace period - plenty of time to counter-steer
    }
  } else {
    state.driftMode = false;
  }
  if (driftActive) {
    state.driftTime += dt;
    state.driftCombo = Math.min(state.driftCombo + dt, 5);
    let multiplier = 1;
    const absGrade = Math.abs(state.gradePercent);
    if (absGrade >= 6) {
      multiplier = 1.5;
    }
    if (absGrade >= 10) {
      multiplier = 2;
    }
    const comboMultiplier = 1 + state.driftCombo * 0.15;
    state.driftScore += dt * multiplier * comboMultiplier;
  } else {
    state.driftTime = Math.max(0, state.driftTime - dt * 2);
    state.driftCombo = Math.max(0, state.driftCombo - dt * 3);
  }

  return {
    speed,
    slipAngleDeg: THREE.MathUtils.radToDeg(state.slipAngle),
    driftActive,
    score: state.driftScore,
    gradePercent: state.gradePercent,
    driftTime: state.driftTime,
    progress: state.progress,
    lateralOffset: state.lateralOffset,
    steerAngleDeg: THREE.MathUtils.radToDeg(state.steerAngle),
    yawRateDeg: THREE.MathUtils.radToDeg(state.yawRate),
    steerInput,
    throttle: input.throttle,
    brake: input.brake,
    handbrake: input.handbrake,
    longitudinalSpeed: vLong,
    lateralSpeed: vLat,
    frontSlipDeg: THREE.MathUtils.radToDeg(alphaFront),
    rearSlipDeg: THREE.MathUtils.radToDeg(alphaRear),
  };
}

function createCarConfig(spec: CarSpec): CarConfig {
  const driftLevel = THREE.MathUtils.clamp(spec.driftControl, 1, 5);
  const driftFactor = driftLevel / 5;
  const powerLevel = THREE.MathUtils.clamp(spec.power, 1, 3);

  const wheelBase = 2.54;
  const cgToFrontAxle = 1.08;
  const cgToRearAxle = wheelBase - cgToFrontAxle;

  const cornerBase = 20000;
  const corneringStiffnessFront = cornerBase + driftFactor * 12000;
  const corneringStiffnessRear = (cornerBase + driftFactor * 14000) * (0.85 + driftFactor * 0.08);

  const slipAngleAtPeak = THREE.MathUtils.degToRad(10 + driftFactor * 12);

  return {
    mass: 1220,
    inertia: 1320,
    cgToFrontAxle,
    cgToRearAxle,
    corneringStiffnessFront,
    corneringStiffnessRear,
    slipAngleAtPeak,
    engineForce: 5200 + powerLevel * 2100,
    brakeForce: 9200,
    handbrakeBrakeForce: 5600,
    dragCoefficient: 0.52,
    rollingResistance: 90,
    maxSteerAngle: THREE.MathUtils.degToRad(32),
    rideHeight: 0.72,
    topSpeed: 44 + powerLevel * 5,
    minDriftSpeed: 9,
    driftThresholdDeg: 30,
    steerLowSpeedFactor: 0.36,
    steerFullSpeed: 30,
    yawLowSpeedFactor: 0.12,
    steerRateLow: THREE.MathUtils.degToRad(120),
    steerRateHigh: THREE.MathUtils.degToRad(38),
    frontGripHighSpeedScale: 0.75,  // Strong enough for counter-steering
    rearGripHighSpeedScale: 0.58,  // Lower to enable drifting while staying controllable
    highSpeedSteerLimit: 0.75,  // Good counter-steering authority
    yawRateLimit: THREE.MathUtils.degToRad(45),
    weightTransferGain: 0.50,  // Increased to help initiate drifts via weight shift
    throttleOversteerStrength: 0,  // DISABLED - using weight transfer only
    throttleYawGain: THREE.MathUtils.degToRad(280),
    handbrakeRearScale: 0.30,  // Lower for easier handbrake drifts
    handbrakeDrag: 1.8,
    handbrakeYawBoost: THREE.MathUtils.degToRad(120),  // Increased for better handbrake response
  };
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) {
    angle -= Math.PI * 2;
  }
  while (angle < -Math.PI) {
    angle += Math.PI * 2;
  }
  return angle;
}
