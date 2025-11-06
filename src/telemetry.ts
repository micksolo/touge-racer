import * as CANNON from 'cannon-es';
import * as THREE from 'three';

/**
 * TELEMETRY & PHYSICS INSTRUMENTATION
 * Calculates slip angles, load transfer, drift state, and other metrics
 */

export interface WheelTelemetry {
  index: number;
  isInContact: boolean;
  suspensionLength: number;
  suspensionCompression: number; // 0-1 (0=fully extended, 1=fully compressed)
  slipAngle: number; // degrees
  normalLoad: number; // estimated load on wheel
  worldVelocity: THREE.Vector3;
  worldPosition: THREE.Vector3;
}

export interface VehicleTelemetry {
  wheels: WheelTelemetry[];
  chassisVelocity: THREE.Vector3;
  chassisAngularVelocity: THREE.Vector3;
  speed: number; // m/s
  speedKmh: number;
  totalLoad: number;
  loadDistribution: {
    front: number; // percentage
    rear: number; // percentage
    left: number;
    right: number;
  };
  driftState: 'GRIP' | 'TRANSITION' | 'DRIFT' | 'SPIN';
  maxSlipAngle: number; // max across all wheels
  avgRearSlipAngle: number; // average of rear wheels
}

/**
 * Calculate slip angle for a wheel
 * Slip angle = angle between wheel direction and actual velocity
 */
export function calculateWheelSlipAngle(
  wheelWorldVelocity: THREE.Vector3,
  wheelForwardDirection: THREE.Vector3
): number {
  // Get velocity magnitude in the plane perpendicular to wheel axis
  const speed = wheelWorldVelocity.length();

  if (speed < 0.1) return 0; // Not moving, no slip

  // Normalize velocity direction
  const velocityDir = wheelWorldVelocity.clone().normalize();

  // Dot product gives cos of angle between forward and velocity
  const dot = wheelForwardDirection.dot(velocityDir);
  const angle = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));

  // Convert to degrees
  return angle * (180 / Math.PI);
}

/**
 * Estimate normal load on each wheel based on suspension compression
 * More compression = more load
 */
export function estimateWheelLoad(
  suspensionLength: number,
  suspensionRestLength: number,
  suspensionStiffness: number,
  maxSuspensionTravel: number
): number {
  // Compression amount (positive = compressed)
  const compression = suspensionRestLength - suspensionLength;

  // Clamp to valid range
  const clampedCompression = Math.max(0, Math.min(compression, maxSuspensionTravel));

  // Force = stiffness × compression (Hooke's law approximation)
  const force = suspensionStiffness * clampedCompression;

  return force;
}

/**
 * Get drift state based on slip angles
 */
export function getDriftState(avgRearSlip: number, maxSlip: number): VehicleTelemetry['driftState'] {
  if (maxSlip > 45) return 'SPIN';
  if (avgRearSlip > 15) return 'DRIFT';
  if (avgRearSlip > 5) return 'TRANSITION';
  return 'GRIP';
}

/**
 * Main telemetry calculation function
 */
export function calculateVehicleTelemetry(
  vehicle: CANNON.RaycastVehicle,
  chassisBody: CANNON.Body
): VehicleTelemetry {
  const wheels: WheelTelemetry[] = [];

  let totalLoad = 0;
  let maxSlipAngle = 0;
  let rearSlipSum = 0;

  // Calculate per-wheel telemetry
  vehicle.wheelInfos.forEach((wheelInfo, i) => {
    // Update wheel transform to get world position/rotation
    vehicle.updateWheelTransform(i);
    const wheelTransform = wheelInfo.worldTransform;

    // Get wheel world position and velocity
    const wheelPos = new THREE.Vector3(
      wheelTransform.position.x,
      wheelTransform.position.y,
      wheelTransform.position.z
    );

    // Calculate wheel velocity: chassis velocity + velocity from rotation
    const chassisVel = new THREE.Vector3(
      chassisBody.velocity.x,
      chassisBody.velocity.y,
      chassisBody.velocity.z
    );

    // Vector from chassis to wheel
    const wheelOffset = new THREE.Vector3(
      wheelInfo.chassisConnectionPointWorld.x - chassisBody.position.x,
      wheelInfo.chassisConnectionPointWorld.y - chassisBody.position.y,
      wheelInfo.chassisConnectionPointWorld.z - chassisBody.position.z
    );

    // Angular velocity contribution: ω × r
    const angularVel = new THREE.Vector3(
      chassisBody.angularVelocity.x,
      chassisBody.angularVelocity.y,
      chassisBody.angularVelocity.z
    );
    const rotationalVel = new THREE.Vector3().crossVectors(angularVel, wheelOffset);

    // Total wheel velocity
    const wheelVelocity = chassisVel.clone().add(rotationalVel);

    // Get wheel forward direction in world space
    const wheelQuat = new THREE.Quaternion(
      wheelTransform.quaternion.x,
      wheelTransform.quaternion.y,
      wheelTransform.quaternion.z,
      wheelTransform.quaternion.w
    );
    const wheelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(wheelQuat);

    // Calculate slip angle
    const slipAngle = calculateWheelSlipAngle(wheelVelocity, wheelForward);
    maxSlipAngle = Math.max(maxSlipAngle, slipAngle);

    // Track rear wheel slip for drift detection (wheels 2, 3)
    if (i >= 2) {
      rearSlipSum += slipAngle;
    }

    // Calculate suspension compression (0-1)
    const compression = 1 - (wheelInfo.suspensionLength / wheelInfo.suspensionRestLength);
    const clampedCompression = Math.max(0, Math.min(1, compression));

    // Estimate load
    const load = estimateWheelLoad(
      wheelInfo.suspensionLength,
      wheelInfo.suspensionRestLength,
      100, // suspensionStiffness (from vehicle config)
      wheelInfo.maxSuspensionTravel
    );
    totalLoad += load;

    wheels.push({
      index: i,
      isInContact: wheelInfo.isInContact,
      suspensionLength: wheelInfo.suspensionLength,
      suspensionCompression: clampedCompression,
      slipAngle,
      normalLoad: load,
      worldVelocity: wheelVelocity,
      worldPosition: wheelPos,
    });
  });

  // Calculate load distribution
  const frontLoad = wheels[0].normalLoad + wheels[1].normalLoad;
  const rearLoad = wheels[2].normalLoad + wheels[3].normalLoad;
  const leftLoad = wheels[0].normalLoad + wheels[2].normalLoad;
  const rightLoad = wheels[1].normalLoad + wheels[3].normalLoad;

  const loadDistribution = {
    front: totalLoad > 0 ? (frontLoad / totalLoad) * 100 : 50,
    rear: totalLoad > 0 ? (rearLoad / totalLoad) * 100 : 50,
    left: totalLoad > 0 ? (leftLoad / totalLoad) * 100 : 50,
    right: totalLoad > 0 ? (rightLoad / totalLoad) * 100 : 50,
  };

  // Chassis velocity
  const chassisVelocity = new THREE.Vector3(
    chassisBody.velocity.x,
    chassisBody.velocity.y,
    chassisBody.velocity.z
  );
  const speed = chassisVelocity.length();

  const chassisAngularVelocity = new THREE.Vector3(
    chassisBody.angularVelocity.x,
    chassisBody.angularVelocity.y,
    chassisBody.angularVelocity.z
  );

  // Drift state
  const avgRearSlipAngle = rearSlipSum / 2;
  const driftState = getDriftState(avgRearSlipAngle, maxSlipAngle);

  return {
    wheels,
    chassisVelocity,
    chassisAngularVelocity,
    speed,
    speedKmh: speed * 3.6,
    totalLoad,
    loadDistribution,
    driftState,
    maxSlipAngle,
    avgRearSlipAngle,
  };
}

/**
 * Format telemetry as HTML for HUD display
 */
export function formatTelemetryHUD(telemetry: VehicleTelemetry, compact: boolean = false): string {
  if (compact) {
    return `
      <strong>Speed:</strong> ${telemetry.speedKmh.toFixed(1)} km/h<br>
      <strong>Drift State:</strong> ${telemetry.driftState}<br>
      <strong>Rear Slip:</strong> ${telemetry.avgRearSlipAngle.toFixed(1)}°
    `;
  }

  // Full telemetry display
  const wheelsOnGround = telemetry.wheels.filter(w => w.isInContact).length;

  // Color code drift state
  let stateColor = '#00ff00'; // GRIP = green
  if (telemetry.driftState === 'TRANSITION') stateColor = '#ffff00'; // yellow
  if (telemetry.driftState === 'DRIFT') stateColor = '#ff8800'; // orange
  if (telemetry.driftState === 'SPIN') stateColor = '#ff0000'; // red

  let html = `
    <strong style="color: #00ffff;">🏔️ TOUGE RACER - TELEMETRY</strong><br>
    <br>
    <strong>Speed:</strong> ${telemetry.speedKmh.toFixed(1)} km/h (${telemetry.speed.toFixed(1)} m/s)<br>
    <strong>Drift State:</strong> <span style="color: ${stateColor}; font-weight: bold;">${telemetry.driftState}</span><br>
    <strong>Wheels on ground:</strong> ${wheelsOnGround}/4<br>
    <br>
    <strong>SLIP ANGLES:</strong><br>
  `;

  // Show each wheel's slip angle
  const wheelLabels = ['FL', 'FR', 'RL', 'RR'];
  telemetry.wheels.forEach((wheel, i) => {
    const slipColor = wheel.slipAngle > 15 ? '#ff8800' : wheel.slipAngle > 5 ? '#ffff00' : '#00ff00';
    const contact = wheel.isInContact ? '✓' : '✗';
    html += `  ${wheelLabels[i]}: <span style="color: ${slipColor}">${wheel.slipAngle.toFixed(1)}°</span> ${contact}<br>`;
  });

  html += `<br><strong>AVG REAR SLIP:</strong> <span style="color: ${stateColor}">${telemetry.avgRearSlipAngle.toFixed(1)}°</span><br>`;

  // Load distribution
  html += `
    <br>
    <strong>LOAD DISTRIBUTION:</strong><br>
    Front: ${telemetry.loadDistribution.front.toFixed(1)}% | Rear: ${telemetry.loadDistribution.rear.toFixed(1)}%<br>
    Left: ${telemetry.loadDistribution.left.toFixed(1)}% | Right: ${telemetry.loadDistribution.right.toFixed(1)}%<br>
    <br>
    <strong>SUSPENSION:</strong><br>
  `;

  // Suspension compression visualization
  telemetry.wheels.forEach((wheel, i) => {
    const compressionBar = '█'.repeat(Math.floor(wheel.suspensionCompression * 10));
    const emptyBar = '░'.repeat(10 - Math.floor(wheel.suspensionCompression * 10));
    html += `  ${wheelLabels[i]}: ${compressionBar}${emptyBar} ${(wheel.suspensionCompression * 100).toFixed(0)}%<br>`;
  });

  return html;
}

/**
 * Console logging for debugging
 */
export function logTelemetry(telemetry: VehicleTelemetry) {
  console.log('📊 TELEMETRY:');
  console.log(`   Speed: ${telemetry.speedKmh.toFixed(1)} km/h`);
  console.log(`   Drift State: ${telemetry.driftState}`);
  console.log(`   Avg Rear Slip: ${telemetry.avgRearSlipAngle.toFixed(1)}°`);
  console.log(`   Load: F${telemetry.loadDistribution.front.toFixed(0)}% R${telemetry.loadDistribution.rear.toFixed(0)}%`);
  telemetry.wheels.forEach((w, i) => {
    console.log(`   Wheel ${i}: slip=${w.slipAngle.toFixed(1)}° contact=${w.isInContact} compression=${(w.suspensionCompression * 100).toFixed(0)}%`);
  });
}
