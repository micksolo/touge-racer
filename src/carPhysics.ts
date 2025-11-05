import * as THREE from 'three';
import { TrackSurface } from './track';
import type { InputSnapshot } from './input';

const GRAVITY = 9.81;

// ============================================================================
// SIMPLE ARCADE PHYSICS - No tire simulation, direct control
// ============================================================================

export interface CarSpec {
  driftControl: number;
  power: number;
}

export interface CarConfig {
  // Speed control
  acceleration: number;
  braking: number;
  topSpeed: number;
  drag: number;

  // Grip mode (normal driving)
  gripTurnRate: number;        // How fast car rotates in grip mode
  gripVelocityFollow: number;  // How quickly velocity follows heading (0-1)

  // Drift mode (sliding)
  driftTurnRate: number;       // How fast car rotates in drift mode
  driftVelocityFollow: number; // How quickly velocity follows heading in drift (0-1)
  driftSpeedLoss: number;      // Speed reduction when initiating drift

  // Handbrake
  handbrakeBoost: number;      // Extra rotation boost with handbrake

  // Transitions
  driftThreshold: number;      // Min speed to drift (m/s)
  returnToGripSpeed: number;   // How fast to exit drift mode

  // Visual
  rideHeight: number;
}

export interface CarState {
  // Position & orientation
  position: THREE.Vector3;
  velocity: THREE.Vector2;  // World-space 2D velocity (x, z)
  yaw: number;               // Car's heading angle (radians)

  // Speeds
  forwardSpeed: number;      // Forward speed (simplified control)

  // Drift state
  isDrifting: boolean;
  driftAngle: number;        // Angle between heading and velocity direction
  driftDuration: number;     // How long we've been drifting (for minimum drift time)
  handbrakeTimer: number;    // Timer for handbrake tap persistence
  lastSteerSign: number;     // Track steering direction for Swedish flick detection
  steerChangeTime: number;   // Time of last steering direction change

  // Scoring
  driftScore: number;
  driftTime: number;
  driftCombo: number;

  // Track info
  progress: number;
  lateralOffset: number;
  gradePercent: number;
  lastProjection: ReturnType<TrackSurface['projectPoint']> | null;

  readonly config: CarConfig;
}

export interface CarTelemetry {
  speed: number;
  slipAngleDeg: number;
  driftActive: boolean;
  driftStateName: string;
  assistStrength: number;
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
    forwardSpeed: 0,
    isDrifting: false,
    driftAngle: 0,
    driftDuration: 0,
    handbrakeTimer: 0,
    lastSteerSign: 0,
    steerChangeTime: 0,
    driftScore: 0,
    driftTime: 0,
    driftCombo: 0,
    progress: startSample.distance,
    lateralOffset: 0,
    gradePercent: startSample.tangent.y * 100,
    lastProjection: null,
    config,
  };
}

// ============================================================================
// MAIN PHYSICS STEP - Simple Arcade Approach
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
  const trackForward2d = new THREE.Vector2(
    projection.sample.tangent.x,
    projection.sample.tangent.z
  );
  if (trackForward2d.lengthSq() > 0) {
    trackForward2d.normalize();
  }
  const gradeSin = projection.sample.tangent.y;
  const forward2d = new THREE.Vector2(Math.cos(state.yaw), Math.sin(state.yaw));
  const alignment = trackForward2d.lengthSq() > 0 ? forward2d.dot(trackForward2d) : 0;
  const gradeAcceleration = -GRAVITY * gradeSin * THREE.MathUtils.clamp(alignment, -1, 1);

  // -------------------------------------------------------------------------
  // 2. SPEED CONTROL (Direct, no tire simulation)
  // -------------------------------------------------------------------------
  const throttle = THREE.MathUtils.clamp(input.throttle, 0, 1);
  const brake = THREE.MathUtils.clamp(input.brake, 0, 1);
  const handbrake = THREE.MathUtils.clamp(input.handbrake, 0, 1);

  // Simple speed control
  if (throttle > 0) {
    const speedRatio = state.forwardSpeed / config.topSpeed;
    const accelPower = 1.0 - speedRatio * speedRatio;  // Reduced power near top speed
    state.forwardSpeed += config.acceleration * throttle * accelPower * dt;
  }

  if (brake > 0) {
    state.forwardSpeed -= config.braking * brake * dt;
  }

  // Grade affects speed
  state.forwardSpeed += gradeAcceleration * dt;

  // Drag
  const dragForce = config.drag * state.forwardSpeed * Math.abs(state.forwardSpeed);
  state.forwardSpeed -= dragForce * dt;

  // Clamp speed
  state.forwardSpeed = THREE.MathUtils.clamp(state.forwardSpeed, -config.topSpeed * 0.3, config.topSpeed);

  const currentSpeed = Math.abs(state.forwardSpeed);

  // Get steering input (needed for drift detection)
  const steerInput = THREE.MathUtils.clamp(input.steer, -1, 1);

  // -------------------------------------------------------------------------
  // 3. DRIFT MODE DETECTION (Swedish flick + handbrake tap)
  // -------------------------------------------------------------------------
  const canDrift = currentSpeed > config.driftThreshold;

  // Swedish flick detection: detect quick steering direction change
  const currentSteerSign = Math.sign(steerInput);
  let detectedSwedishFlick = false;
  let isCounterDrift = false;

  if (currentSteerSign !== 0 && state.lastSteerSign !== 0 && currentSteerSign !== state.lastSteerSign) {
    // Steering direction changed
    const timeSinceChange = state.steerChangeTime;
    if (timeSinceChange < 0.8) {
      // Quick flick (keyboard-friendly timing) = Swedish drift!
      detectedSwedishFlick = canDrift;

      // Check if this is a counter-drift (flick + handbrake opposite to current drift direction)
      if (state.isDrifting && handbrake > 0.5) {
        // If drift angle and steering input have opposite signs, it's a counter-drift
        const driftDirection = Math.sign(state.driftAngle);
        const steerDirection = Math.sign(steerInput);
        // Counter-drift: steering opposite to drift direction + handbrake
        if (driftDirection !== 0 && steerDirection !== 0 && driftDirection !== steerDirection) {
          isCounterDrift = true;
          if (diagnosticMode) {
            console.log(`🔄 COUNTER-DRIFT! Flick + handbrake snapping to opposite direction`);
          }
        }
      }

      if (diagnosticMode && !isCounterDrift) {
        console.log(`🏁 SWEDISH FLICK! Changed direction in ${(timeSinceChange * 1000).toFixed(0)}ms`);
      }
    } else if (diagnosticMode) {
      console.log(`⏱️ Steering change too slow: ${(timeSinceChange * 1000).toFixed(0)}ms (need < 800ms)`);
    }
    state.steerChangeTime = 0;
  }

  if (currentSteerSign !== 0) {
    state.lastSteerSign = currentSteerSign;
    state.steerChangeTime += dt;
  }

  // Handbrake tap: persist drift intention for 0.5s after release
  if (handbrake > 0.5) {
    state.handbrakeTimer = 0.5;  // Set 0.5s timer
  } else {
    state.handbrakeTimer = Math.max(0, state.handbrakeTimer - dt);
  }

  const wantsDrift = handbrake > 0.5 || state.handbrakeTimer > 0 || detectedSwedishFlick;

  // Enter drift mode
  if (wantsDrift && canDrift && !state.isDrifting) {
    state.isDrifting = true;
    state.driftDuration = 0;  // Reset drift timer
    // Slight speed loss on initiation
    state.forwardSpeed *= (1.0 - config.driftSpeedLoss);

    if (diagnosticMode && detectedSwedishFlick) {
      console.log('🏁 SWEDISH FLICK DETECTED! Drift initiated');
    }
  }

  // Update drift duration
  if (state.isDrifting) {
    state.driftDuration += dt;
  }

  // Exit drift mode when drift angle is small (with minimum drift duration for arcade feel)
  const minDriftDuration = 0.4;  // Initial D style: drifts feel "committed"
  if (state.isDrifting && !wantsDrift && state.driftDuration > minDriftDuration) {
    const driftAngleDeg = Math.abs(state.driftAngle) * 180 / Math.PI;
    if (driftAngleDeg < 20 || currentSpeed < config.driftThreshold * 0.7) {
      state.isDrifting = false;
      state.driftAngle = 0;
      state.driftDuration = 0;
    }
  }

  // -------------------------------------------------------------------------
  // 4. STEERING (Mode-dependent)
  // -------------------------------------------------------------------------
  // Speed-based steering reduction
  const speedFactor = THREE.MathUtils.clamp(currentSpeed / 30, 0, 1);
  const steerReduction = THREE.MathUtils.lerp(1.0, 0.6, speedFactor);

  let rotationRate: number;

  if (state.isDrifting) {
    // DRIFT MODE: Fast rotation (negate for correct direction)
    rotationRate = -config.driftTurnRate * steerInput * steerReduction;

    // Handbrake boost (only applies when actually steering)
    if (wantsDrift && Math.abs(steerInput) > 0.1) {
      const boostDirection = -Math.sign(steerInput);
      const speedBoostFactor = THREE.MathUtils.smoothstep(currentSpeed, 10, 30);
      rotationRate += config.handbrakeBoost * boostDirection * speedBoostFactor;
    }

    // Swedish flick boost (big kick when flick detected)
    if (detectedSwedishFlick && Math.abs(steerInput) > 0.1) {
      const flickDirection = -Math.sign(steerInput);
      const speedBoostFactor = THREE.MathUtils.smoothstep(currentSpeed, 15, 40);

      if (isCounterDrift) {
        // COUNTER-DRIFT: Extra strong snap to opposite direction
        rotationRate += config.handbrakeBoost * 2.5 * flickDirection * speedBoostFactor;
        // Reset drift duration to allow immediate transition
        state.driftDuration = 0;
        // Reduce current drift angle to help transition
        state.driftAngle *= 0.3;
      } else {
        // Normal Swedish flick gives extra strong initial rotation
        rotationRate += config.handbrakeBoost * 1.5 * flickDirection * speedBoostFactor;
      }
    }
  } else {
    // GRIP MODE: Normal rotation (negate for correct direction)
    rotationRate = -config.gripTurnRate * steerInput * steerReduction;
  }

  // Apply rotation
  state.yaw += rotationRate * dt;
  state.yaw = normalizeAngle(state.yaw);

  // -------------------------------------------------------------------------
  // 5. VELOCITY CONTROL (Mode-dependent)
  // -------------------------------------------------------------------------
  const headingVec = new THREE.Vector2(
    Math.cos(state.yaw),
    Math.sin(state.yaw)
  );

  // Target velocity: direction car is pointing, magnitude from forwardSpeed
  const targetVelocity = headingVec.clone().multiplyScalar(state.forwardSpeed);

  // How much velocity follows heading depends on mode
  const followRate = state.isDrifting
    ? config.driftVelocityFollow
    : config.gripVelocityFollow;

  // Smoothly blend velocity toward target
  state.velocity.lerp(targetVelocity, followRate * dt * 10);

  // Calculate drift angle (difference between heading and velocity direction)
  if (state.velocity.lengthSq() > 0.1) {
    const velocityAngle = Math.atan2(state.velocity.y, state.velocity.x);
    state.driftAngle = normalizeAngle(state.yaw - velocityAngle);
  } else {
    state.driftAngle = 0;
  }

  // Gradually reduce drift angle when exiting drift
  if (!state.isDrifting) {
    state.driftAngle *= Math.pow(0.1, dt * config.returnToGripSpeed);
  }

  // -------------------------------------------------------------------------
  // 6. POSITION UPDATE
  // -------------------------------------------------------------------------
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.y * dt;

  // -------------------------------------------------------------------------
  // 7. TRACK SURFACE CONSTRAINTS
  // -------------------------------------------------------------------------
  const updatedProjection = track.projectPoint(state.position);
  state.lastProjection = updatedProjection;
  const sampleNormal = updatedProjection.sample.normal.clone();
  const sampleBinormal = updatedProjection.sample.binormal.clone();

  // Height constraint
  const targetHeightPosition = updatedProjection.projected
    .clone()
    .addScaledVector(sampleNormal, config.rideHeight);
  const normalError = targetHeightPosition.sub(state.position).dot(sampleNormal);
  state.position.addScaledVector(sampleNormal, normalError);

  // Lateral constraint
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

  // Guardrail collision - slow down when hitting track edges
  const edgeThreshold = clampLimit * 0.9; // Start penalty at 90% of track edge
  const absLateral = Math.abs(state.lateralOffset);
  if (absLateral > edgeThreshold) {
    const collisionAmount = (absLateral - edgeThreshold) / (clampLimit - edgeThreshold);
    const speedPenalty = 0.97 - (collisionAmount * 0.08); // 97% to 89% speed retention per frame
    state.forwardSpeed *= speedPenalty;
    // Gentle scrub of lateral velocity when hitting walls
    const lateralVelReduction = 0.92;
    state.velocity.multiplyScalar(lateralVelReduction);
  }

  const finalTarget = updatedProjection.projected
    .clone()
    .addScaledVector(sampleNormal, config.rideHeight)
    .addScaledVector(sampleBinormal, state.lateralOffset);
  const finalHeightError = finalTarget.sub(state.position).dot(sampleNormal);
  state.position.addScaledVector(sampleNormal, finalHeightError);

  state.progress = updatedProjection.sample.distance;
  state.gradePercent = updatedProjection.sample.tangent.y * 100;

  // -------------------------------------------------------------------------
  // 8. DRIFT SCORING
  // -------------------------------------------------------------------------
  const driftAngleDeg = Math.abs(state.driftAngle) * 180 / Math.PI;
  const driftActive = driftAngleDeg > 20 && currentSpeed > 10;

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
  // 9. DIAGNOSTIC LOGGING
  // -------------------------------------------------------------------------
  if (diagnosticMode && (Math.abs(steerInput) > 0.1 || handbrake > 0.1)) {
    console.log('🎮 ARCADE PHYSICS:', {
      mode: state.isDrifting ? 'DRIFT' : 'GRIP',
      speed: currentSpeed.toFixed(1) + ' m/s',
      yaw: (state.yaw * 180 / Math.PI).toFixed(1) + '°',
      driftAngle: driftAngleDeg.toFixed(1) + '°',
      rotation: (rotationRate * 180 / Math.PI).toFixed(1) + '°/s',
      velocityFollow: (followRate * 100).toFixed(0) + '%',
      steer: steerInput.toFixed(2),
      handbrake: handbrake.toFixed(2)
    });
  }

  // -------------------------------------------------------------------------
  // 10. TELEMETRY
  // -------------------------------------------------------------------------
  return {
    speed: currentSpeed,
    slipAngleDeg: driftAngleDeg,
    driftActive,
    driftStateName: state.isDrifting ? 'DRIFT' : 'GRIP',
    assistStrength: 0,
    score: state.driftScore,
    gradePercent: state.gradePercent,
    driftTime: state.driftTime,
    progress: state.progress,
    lateralOffset: state.lateralOffset,
    steerAngleDeg: steerInput * 30,  // Fake value for HUD
    yawRateDeg: rotationRate * 180 / Math.PI,
    steerInput,
    throttle,
    brake,
    handbrake,
    longitudinalSpeed: state.forwardSpeed,
    lateralSpeed: 0,  // Not tracked in simple model
    frontSlipDeg: 0,  // Not applicable
    rearSlipDeg: driftAngleDeg,
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

function createCarConfig(spec: CarSpec): CarConfig {
  const driftLevel = THREE.MathUtils.clamp(spec.driftControl, 1, 5);
  const powerLevel = THREE.MathUtils.clamp(spec.power, 1, 3);

  return {
    // Speed control
    acceleration: 15 + powerLevel * 5,
    braking: 25,
    topSpeed: 40 + powerLevel * 8,
    drag: 0.004,  // Much lower drag (was 0.08, way too high)

    // Grip mode (tight, responsive)
    gripTurnRate: THREE.MathUtils.degToRad(90),   // 90°/s
    gripVelocityFollow: 0.95,  // Velocity almost perfectly follows heading

    // Drift mode (loose, slidey)
    driftTurnRate: THREE.MathUtils.degToRad(150 + driftLevel * 20),  // 150-250°/s
    driftVelocityFollow: 0.15,  // Velocity loosely follows heading (sliding)
    driftSpeedLoss: 0.15,  // Lose 15% speed on drift initiation

    // Handbrake
    handbrakeBoost: THREE.MathUtils.degToRad(120),  // Extra 120°/s rotation

    // Transitions
    driftThreshold: 12,  // Need 12 m/s (43 km/h) to drift
    returnToGripSpeed: 3.0,  // How fast drift angle decays

    // Visual
    rideHeight: 0.72,
  };
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
