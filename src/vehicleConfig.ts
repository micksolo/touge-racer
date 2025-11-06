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
  description: 'Prototype test vehicle (800kg)',

  chassis: {
    halfWidth: 1.0,
    halfHeight: 0.5,
    halfLength: 2.0,
    mass: 800,  // Increased from 150kg - was too light and bouncing
    centerOfMassOffset: new CANNON.Vec3(0, -0.5, 0),
  },

  wheels: {
    radius: 0.4,
    positions: [
      new CANNON.Vec3(-1, -0.5, 1.2),  // Front-left
      new CANNON.Vec3(1, -0.5, 1.2),   // Front-right
      new CANNON.Vec3(-1, -0.5, -1.2), // Rear-left
      new CANNON.Vec3(1, -0.5, -1.2),  // Rear-right
    ],
  },

  suspension: {
    stiffness: 100,
    restLength: 0.5,
    dampingCompression: 12.0,  // Increased from 8.0 to reduce bouncing
    dampingRelaxation: 8.0,    // Increased from 5.0 to reduce bouncing
    maxForce: 50000,  // Increased from 10000 to support 800kg mass
    maxTravel: 0.5,
  },

  dynamics: {
    angularDamping: 0.9,  // Increased from 0.8 to prevent flipping
    linearDamping: 0.1,   // Increased from 0.05 to reduce bouncing
  },

  power: {
    maxEngineForce: 500,  // Increased from 150 for 800kg mass
    maxBrakeForce: 300,   // Increased from 100 for 800kg mass
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
