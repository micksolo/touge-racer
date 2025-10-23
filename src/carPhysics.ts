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
  const steerAngle = -steerInput * config.maxSteerAngle * steerGain;
  state.steerAngle = steerAngle;

  const effectiveSpeed = Math.max(Math.abs(vLong), 0.6);
  const gripScale = input.handbrake > 0 ? config.handbrakeGripScale : 1;
  const Cf = config.corneringStiffnessFront * gripScale;
  const Cr = config.corneringStiffnessRear * gripScale;

  const alphaFront = Math.atan2(vLat + config.cgToFrontAxle * state.yawRate, effectiveSpeed) - steerAngle;
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

  vLong += (ax + state.yawRate * oldVLat) * dt;
  vLat += (ay - state.yawRate * oldVLong) * dt;

  const yawAcc = (config.cgToFrontAxle * Fyf - config.cgToRearAxle * Fyr) / config.inertia;
  const yawResponse = THREE.MathUtils.lerp(config.yawLowSpeedFactor, 1, steerSpeedFactor);
  state.yawRate += yawAcc * dt * yawResponse;
  state.yawRate *= 1 - Math.min(dt * 0.6, 0.08);
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
  const laneOffsetVector = state.position.clone().sub(updatedProjection.projected);
  const lateral = laneOffsetVector.dot(updatedProjection.sample.binormal);
  const clampLimit = track.width * 0.5 - 0.9;
  const clampedLateral = THREE.MathUtils.clamp(lateral, -clampLimit, clampLimit);
  state.lateralOffset = clampedLateral;
  state.position
    .copy(updatedProjection.projected)
    .addScaledVector(updatedProjection.sample.binormal, clampedLateral)
    .addScaledVector(updatedProjection.sample.normal, config.rideHeight);

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
    steerLowSpeedFactor: 0.45,
    steerFullSpeed: 16,
    yawLowSpeedFactor: 0.24,
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
