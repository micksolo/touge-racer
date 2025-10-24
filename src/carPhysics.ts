import * as THREE from 'three';
import { TrackSurface } from './track';
import type { InputSnapshot } from './input';

const GRAVITY = 9.81;

export interface CarSpec {
  driftControl: number;
  power: number;
}

interface CarConfig {
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
  handbrakeGripScale: number;
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
    slipAngle: 0,
    gradePercent: startSample.tangent.y * 100,
    progress: startSample.distance,
    lateralOffset: 0,
    lastProjection: null,
    config,
  };
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
  const targetSteerAngle = -steerInput * config.maxSteerAngle * steerGain * steerLimit;
  const steerRate = THREE.MathUtils.lerp(config.steerRateLow, config.steerRateHigh, steerSpeedFactor);
  const maxSteerDelta = steerRate * dt;
  const steerError = THREE.MathUtils.clamp(targetSteerAngle - state.steerAngle, -maxSteerDelta, maxSteerDelta);
  state.steerAngle += steerError;

  const effectiveSpeed = Math.max(Math.abs(vLong), 0.6);
  const gripScale = input.handbrake > 0 ? config.handbrakeGripScale : 1;
  const frontGripScale = THREE.MathUtils.lerp(1, config.frontGripHighSpeedScale, highSpeedFactor);
  const rearGripScale = THREE.MathUtils.lerp(1, config.rearGripHighSpeedScale, highSpeedFactor);
  const Cf = config.corneringStiffnessFront * gripScale * frontGripScale;
  const Cr = config.corneringStiffnessRear * gripScale * rearGripScale;

  const alphaFront = Math.atan2(vLat + config.cgToFrontAxle * state.yawRate, effectiveSpeed) - state.steerAngle;
  const alphaRear = Math.atan2(vLat - config.cgToRearAxle * state.yawRate, effectiveSpeed);

  const Fyf = -Cf * Math.tanh(alphaFront / config.slipAngleAtPeak);
  const Fyr = -Cr * Math.tanh(alphaRear / config.slipAngleAtPeak);

  const engineForce =
    Math.max(0, input.throttle) *
    config.engineForce *
    (1 - THREE.MathUtils.clamp(speed / config.topSpeed, 0, 1));
  const dragging = config.dragCoefficient * vLong * Math.abs(vLong);
  const rolling = config.rollingResistance * Math.sign(vLong);
  const brakeForce = Math.sign(vLong || 1) * Math.max(0, input.brake) * config.brakeForce;
  const handbrakeForce =
    Math.sign(vLong || 1) * Math.max(0, input.handbrake) * config.handbrakeBrakeForce;

  const ax =
    (engineForce - dragging - rolling - brakeForce - handbrakeForce) / config.mass + gradeAcceleration;
  const ay = (Fyf + Fyr) / config.mass;

  const oldVLong = vLong;
  const oldVLat = vLat;

  const crossLong = THREE.MathUtils.clamp(state.yawRate * oldVLat, -18, 18);
  const crossLat = THREE.MathUtils.clamp(state.yawRate * oldVLong, -18, 18);

  vLong += (ax + crossLong) * dt;
  vLat += (ay - crossLat) * dt;

  const yawAcc = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;
  const yawResponse =
    THREE.MathUtils.lerp(config.yawLowSpeedFactor, 1, steerSpeedFactor) *
    THREE.MathUtils.lerp(1, 0.75, highSpeedFactor);
  state.yawRate += yawAcc * dt * yawResponse;
  state.yawRate *= 1 - Math.min(dt * 0.6, 0.08);
  state.yawRate = THREE.MathUtils.clamp(state.yawRate, -config.yawRateLimit, config.yawRateLimit);
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

  const approachingRail = Math.abs(state.lateralOffset) > clampLimit - 0.45;
  if (approachingRail) {
    const binormal2d = new THREE.Vector2(sampleBinormal.x, sampleBinormal.z);
    if (binormal2d.lengthSq() > 0) {
      binormal2d.normalize();
      const lateralVel = state.velocity.dot(binormal2d);
      const outwardSign = Math.sign(state.lateralOffset || 1);
      if (lateralVel * outwardSign > 0) {
        const correction = -lateralVel * 1.1;
        state.velocity.addScaledVector(binormal2d, correction);
      }
    }
    state.velocity.multiplyScalar(0.985);
  }

  state.progress = updatedProjection.sample.distance;
  state.gradePercent = updatedProjection.sample.tangent.y * 100;
  state.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.1));

  const driftThreshold = config.driftThresholdDeg;
  const slipDeg = THREE.MathUtils.radToDeg(Math.abs(state.slipAngle));
  const driftSpeedOk = speed > config.minDriftSpeed;
  const driftActive = slipDeg > driftThreshold && driftSpeedOk;
  state.driftActive = driftActive;
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

  const cornerBase = 24000;
  const corneringStiffnessFront = cornerBase + driftFactor * 14000;
  const corneringStiffnessRear = (cornerBase + driftFactor * 16000) * (0.95 + driftFactor * 0.08);

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
    handbrakeGripScale: 0.25,
    rideHeight: 0.72,
    topSpeed: 44 + powerLevel * 5,
    minDriftSpeed: 9,
    driftThresholdDeg: 30,
    steerLowSpeedFactor: 0.3,
    steerFullSpeed: 34,
    yawLowSpeedFactor: 0.12,
    steerRateLow: THREE.MathUtils.degToRad(120),
    steerRateHigh: THREE.MathUtils.degToRad(38),
    frontGripHighSpeedScale: 0.85,
    rearGripHighSpeedScale: 0.92,
    highSpeedSteerLimit: 0.32,
    yawRateLimit: THREE.MathUtils.degToRad(26),
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
