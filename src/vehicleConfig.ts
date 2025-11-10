import * as CANNON from 'cannon-es';

/**
 * VEHICLE CONFIGURATION SYSTEM
 * Allows switching between different vehicle setups for testing
 */

export interface VehicleConfig {
  name: string;
  description: string;

  // Chassis dimensions (half-extents for CANNON.Box)
  chassis: {
    halfWidth: number;   // X
    halfHeight: number;  // Y
    halfLength: number;  // Z
    mass: number;
    centerOfMassOffset: CANNON.Vec3;
  };

  // Wheel configuration
  wheels: {
    radius: number;
    positions: CANNON.Vec3[]; // 4 wheel positions relative to chassis
  };

  // Suspension
  suspension: {
    stiffness: number;
    restLength: number;
    dampingCompression: number;
    dampingRelaxation: number;
    maxForce: number;
    maxTravel: number;
  };

  // Dynamics
  dynamics: {
    angularDamping: number;
    linearDamping: number;
  };

  // Power
  power: {
    maxEngineForce: number;
    maxBrakeForce: number;
    maxSteerAngle: number; // radians
  };

  // Tire friction (base value, will be dynamic later)
  tire: {
    frictionSlip: number;
    rollInfluence: number;
  };
}

/**
 * Current prototype config (800kg test vehicle)
 */
export const PROTO_CONFIG: VehicleConfig = {
  name: 'Prototype',
  description: 'Prototype test vehicle (2200kg, ultra-stable setup)',

  chassis: {
    // Compact dimensions for narrow touge roads
    halfWidth: 0.75,   // 1.5m total width (was 2.0m)
    halfHeight: 0.5,   // 1.0m height
    halfLength: 1.8,   // 3.6m length (was 4.0m)
    mass: 2200,        // Very heavy for maximum stability
    centerOfMassOffset: new CANNON.Vec3(0, -0.7, 0.9), // Very low and front-heavy to prevent wheelies
  },

  wheels: {
    radius: 0.35,  // Smaller wheels (70cm diameter, was 80cm)
    positions: [
      // Narrower track width (1.3m vs 2.0m) and shorter wheelbase (2.2m vs 2.4m)
      new CANNON.Vec3(-0.65, -0.5, 1.1),  // Front-left
      new CANNON.Vec3(0.65, -0.5, 1.1),   // Front-right
      new CANNON.Vec3(-0.65, -0.5, -1.1), // Rear-left
      new CANNON.Vec3(0.65, -0.5, -1.1),  // Rear-right
    ],
  },

  suspension: {
    stiffness: 100,            // Stiffer to support 2200kg
    restLength: 0.3,           // Short suspension for low, stable ride
    dampingCompression: 25.0,  // Higher compression damping to absorb bumps
    dampingRelaxation: 30.0,   // Very high rebound damping to prevent bouncing
    maxForce: 120000,          // Strong suspension to support 2200kg
    maxTravel: 0.15,           // Even more limited travel
  },

  dynamics: {
    angularDamping: 0.95,  // Very high to prevent wheelies and flipping
    linearDamping: 0.08,   // Low damping - let engine provide the power
  },

  power: {
    maxEngineForce: 3000,  // Scaled for 2200kg mass
    maxBrakeForce: 2200,   // Strong brakes scaled for mass
    maxSteerAngle: Math.PI / 8, // 22.5 degrees
  },

  tire: {
    frictionSlip: 5,
    rollInfluence: 0.01,
  },
};

/**
 * AE86-inspired realistic config (1100kg drift car)
 * Based on Toyota AE86 dimensions
 */
export const AE86_CONFIG: VehicleConfig = {
  name: 'AE86 (Realistic)',
  description: 'Toyota AE86-inspired dimensions (1100kg)',

  chassis: {
    // AE86: 4.2m × 1.7m × 1.3m → half-extents
    halfWidth: 0.85,   // 1.7m width
    halfHeight: 0.65,  // 1.3m height
    halfLength: 2.1,   // 4.2m length
    mass: 1100,
    centerOfMassOffset: new CANNON.Vec3(0, -0.4, -0.2), // Slightly rear-biased
  },

  wheels: {
    radius: 0.325, // 65cm diameter (15-16 inch wheels)
    positions: [
      // Track width: 1.45m (front/rear)
      // Wheelbase: 2.4m → front at +1.2, rear at -1.2
      new CANNON.Vec3(-0.725, -0.45, 1.2),  // Front-left
      new CANNON.Vec3(0.725, -0.45, 1.2),   // Front-right
      new CANNON.Vec3(-0.725, -0.45, -1.2), // Rear-left
      new CANNON.Vec3(0.725, -0.45, -1.2),  // Rear-right
    ],
  },

  suspension: {
    // Stiffer front for realistic FR layout
    stiffness: 80, // Front will be tuned separately in drift implementation
    restLength: 0.4, // 15cm ground clearance
    dampingCompression: 6.0,
    dampingRelaxation: 4.5,
    maxForce: 50000, // Higher to support 1100kg
    maxTravel: 0.3,
  },

  dynamics: {
    angularDamping: 0.5, // Less damping for more rotation freedom
    linearDamping: 0.02,
  },

  power: {
    maxEngineForce: 800, // ~200Nm peak torque approximation
    maxBrakeForce: 300,
    maxSteerAngle: Math.PI / 6, // 30 degrees
  },

  tire: {
    frictionSlip: 4, // Will be dynamic based on slip angle later
    rollInfluence: 0.05,
  },
};

/**
 * 240SX-inspired config (1200kg drift car)
 * Based on Nissan 240SX dimensions
 */
export const S13_CONFIG: VehicleConfig = {
  name: '240SX (S13)',
  description: 'Nissan 240SX dimensions (1200kg)',

  chassis: {
    // 240SX: 4.5m × 1.7m × 1.3m
    halfWidth: 0.85,
    halfHeight: 0.65,
    halfLength: 2.25,
    mass: 1200,
    centerOfMassOffset: new CANNON.Vec3(0, -0.4, -0.15),
  },

  wheels: {
    radius: 0.33, // 66cm diameter
    positions: [
      new CANNON.Vec3(-0.73, -0.45, 1.3),  // Front-left
      new CANNON.Vec3(0.73, -0.45, 1.3),   // Front-right
      new CANNON.Vec3(-0.73, -0.45, -1.3), // Rear-left
      new CANNON.Vec3(0.73, -0.45, -1.3),  // Rear-right
    ],
  },

  suspension: {
    stiffness: 75,
    restLength: 0.38,
    dampingCompression: 6.5,
    dampingRelaxation: 4.8,
    maxForce: 55000,
    maxTravel: 0.32,
  },

  dynamics: {
    angularDamping: 0.5,
    linearDamping: 0.02,
  },

  power: {
    maxEngineForce: 900, // SR20DET ~220hp
    maxBrakeForce: 350,
    maxSteerAngle: Math.PI / 6,
  },

  tire: {
    frictionSlip: 4,
    rollInfluence: 0.05,
  },
};

/**
 * Available configurations
 */
export const VEHICLE_CONFIGS = {
  proto: PROTO_CONFIG,
  ae86: AE86_CONFIG,
  s13: S13_CONFIG,
};

export type VehicleConfigKey = keyof typeof VEHICLE_CONFIGS;

/**
 * Get config by name
 */
export function getVehicleConfig(key: VehicleConfigKey): VehicleConfig {
  return VEHICLE_CONFIGS[key];
}

/**
 * Create vehicle description string
 */
export function describeVehicle(config: VehicleConfig): string {
  return `
${config.name}
${config.description}

Dimensions: ${config.chassis.halfLength * 2}m × ${config.chassis.halfWidth * 2}m × ${config.chassis.halfHeight * 2}m
Mass: ${config.chassis.mass}kg
Wheel radius: ${config.wheels.radius}m (${config.wheels.radius * 2 * 100}cm diameter)
Suspension: stiffness=${config.suspension.stiffness}, travel=${config.suspension.maxTravel}m
Power: ${config.power.maxEngineForce}N engine, ${config.power.maxBrakeForce}N brake
  `.trim();
}
