import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TrackSurface } from './track';
import type { InputSnapshot } from './input';
import type { CarSpec, CarTelemetry } from './carPhysics';

// ============================================================================
// CANNON-ES VEHICLE PHYSICS
// ============================================================================

export interface CannonCarState {
  // Physics world
  world: CANNON.World;

  // Vehicle
  vehicle: CANNON.RaycastVehicle;
  chassisBody: CANNON.Body;

  // Track physics
  trackBodies: CANNON.Body[];

  // Telemetry
  driftScore: number;
  driftTime: number;
  driftCombo: number;

  // Track info
  track: TrackSurface;

  // Config
  readonly spec: CarSpec;

  // Debug
  frameCount: number;
}

export function createCannonCarState(track: TrackSurface, spec: CarSpec): CannonCarState {
  // Create physics world
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0),
  });

  // Use SAP broadphase for better performance
  world.broadphase = new CANNON.SAPBroadphase(world);

  // Increase solver iterations for more stable physics
  world.solver.iterations = 10;

  // Set default contact material
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.0;

  // Allow sleeping for better performance
  world.allowSleep = true;

  // Create chassis body
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1.7, 0.55, 3.05)); // Half-extents
  // Disable chassis collision - only wheels should interact with ground
  // This prevents torque spikes from chassis hitting track
  chassisShape.collisionResponse = false;

  const chassisBody = new CANNON.Body({
    mass: 1200, // kg
    shape: chassisShape,
    linearDamping: 0.01,   // Small damping for stability
    angularDamping: 0.9,   // Very high angular damping to prevent ANY rotation
  });

  // Get start position from track
  const startSample = track.getSampleAtDistance(0);

  // Calculate ride height to spawn car with wheels just barely touching ground
  // Formula: rideHeight = wheelYOffset + suspensionRestLength + wheelRadius
  const wheelYOffset = 0.45;  // Wheel connection point below chassis center
  const suspensionRestLength = 0.7;  // From wheelOptions below
  const wheelRadius = 0.55;  // From wheelOptions below
  const rideHeight = wheelYOffset + suspensionRestLength + wheelRadius;

  // Spawn at EXACT ride height (no compression)
  // Let gravity settle the car naturally during warm-up
  chassisBody.position.set(
    startSample.position.x,
    startSample.position.y + rideHeight,  // NO subtraction - perfect ride height
    startSample.position.z
  );

  // TESTING: Start with NO rotation (identity quaternion) to isolate orientation issues
  // TODO: Re-enable track-aligned rotation once stable
  const yaw = Math.atan2(startSample.tangent.z, startSample.tangent.x);

  // Use identity quaternion (no rotation) for testing
  chassisBody.quaternion.set(0, 0, 0, 1);

  console.log('⚠️  Using identity quaternion (no rotation) for testing');

  // Zero initial velocity
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);

  // Force car to not sleep initially
  chassisBody.wakeUp();

  console.log('🚗 Car spawn:', {
    position: `(${chassisBody.position.x.toFixed(1)}, ${chassisBody.position.y.toFixed(1)}, ${chassisBody.position.z.toFixed(1)})`,
    rideHeight: `${rideHeight.toFixed(2)}m`,
    quaternion: `(${chassisBody.quaternion.x.toFixed(2)}, ${chassisBody.quaternion.y.toFixed(2)}, ${chassisBody.quaternion.z.toFixed(2)}, ${chassisBody.quaternion.w.toFixed(2)})`,
    note: 'Identity quaternion - no rotation'
  });

  world.addBody(chassisBody);

  // Create vehicle with Three.js convention (NOT Bullet default)
  // Three.js: right=X, up=Y, forward=Z
  // Bullet default: right=Z, up=Y, forward=X
  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,   // X-axis
    indexUpAxis: 1,      // Y-axis
    indexForwardAxis: 2, // Z-axis
  });

  // Wheel configuration - tuned for stable vehicle physics
  const wheelOptions = {
    radius: 0.55,
    directionLocal: new CANNON.Vec3(0, -1, 0),  // Raycast downward (Y is up in Bullet)
    suspensionStiffness: 100,      // Strong enough to support 1200kg mass (was 22 - too weak!)
    suspensionRestLength: 0.7,     // Rest length for normal ride height
    frictionSlip: 5,               // High grip
    dampingRelaxation: 6,          // Damping when extending
    dampingCompression: 8,         // Damping when compressing (prevents bounce)
    maxSuspensionForce: 60000,     // Higher limit to not clamp spring force
    rollInfluence: 0.01,           // Very minimal roll
    axleLocal: new CANNON.Vec3(-1, 0, 0),  // Wheel rotation axis (X for Bullet default)
    chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 1),  // Will be set per wheel
    maxSuspensionTravel: 1.2,      // Longer travel for safety margin
    customSlidingRotationalSpeed: -30,  // Wheel rotation when sliding
    useCustomSlidingRotationalSpeed: true,
  };

  // Wheel positions for THREE.JS convention (right=X, up=Y, forward=Z)
  // Format: (left/right, down, forward/back)
  const wheelPositions = [
    new CANNON.Vec3(-1.45, -0.45, 1.9),   // Front left: -X (left), -Y (down), +Z (forward)
    new CANNON.Vec3(1.45, -0.45, 1.9),    // Front right: +X (right), -Y (down), +Z (forward)
    new CANNON.Vec3(-1.45, -0.45, -1.9),  // Rear left: -X (left), -Y (down), -Z (back)
    new CANNON.Vec3(1.45, -0.45, -1.9),   // Rear right: +X (right), -Y (down), -Z (back)
  ];

  wheelPositions.forEach((position) => {
    const options = {
      ...wheelOptions,
      chassisConnectionPointLocal: position,
    };
    vehicle.addWheel(options);
  });

  vehicle.addToWorld(world);

  console.log('🚗 Vehicle created with', vehicle.wheelInfos.length, 'wheels');
  console.log(`   Using THREE.JS convention: right=X(${vehicle.indexRightAxis}), up=Y(${vehicle.indexUpAxis}), forward=Z(${vehicle.indexForwardAxis})`);
  vehicle.wheelInfos.forEach((wheel, i) => {
    console.log(`  Wheel ${i}: connection=(${wheel.chassisConnectionPointLocal.x.toFixed(2)}, ${wheel.chassisConnectionPointLocal.y.toFixed(2)}, ${wheel.chassisConnectionPointLocal.z.toFixed(2)}), direction=(${wheel.directionLocal.x.toFixed(2)}, ${wheel.directionLocal.y.toFixed(2)}, ${wheel.directionLocal.z.toFixed(2)}), radius=${wheel.radius.toFixed(2)}, suspensionRestLength=${wheel.suspensionRestLength.toFixed(2)}`);
  });

  // Create track collision mesh
  const trackBodies = createTrackCollision(world, track);

  // DIAGNOSTIC: Test if raycasts work at all with the box
  console.log('🔍 Testing manual raycast from car position...');
  console.log(`   Bodies in world: ${world.bodies.length}`);
  world.bodies.forEach((body, idx) => {
    console.log(`   Body ${idx}: mass=${body.mass}, position=(${body.position.x.toFixed(2)}, ${body.position.y.toFixed(2)}, ${body.position.z.toFixed(2)}), shapes=${body.shapes.length}`);
  });

  const testFrom = new CANNON.Vec3(
    chassisBody.position.x,
    chassisBody.position.y,
    chassisBody.position.z
  );
  const testTo = new CANNON.Vec3(
    chassisBody.position.x,
    chassisBody.position.y - 5, // Ray 5 meters downward
    chassisBody.position.z
  );
  const testResult = new CANNON.RaycastResult();

  // Try with different raycast options
  const rayOptions = {
    skipBackfaces: false,
    checkCollisionResponse: false,
  };
  world.raycastClosest(testFrom, testTo, rayOptions, testResult);

  if (testResult.hasHit) {
    console.log(`  ✅ Manual raycast HIT at Y=${testResult.hitPointWorld.y.toFixed(2)}`);
    console.log(`     Hit body type: ${testResult.body?.type === CANNON.Body.STATIC ? 'STATIC' : 'DYNAMIC'}`);
    console.log(`     Hit normal: (${testResult.hitNormalWorld.x.toFixed(2)}, ${testResult.hitNormalWorld.y.toFixed(2)}, ${testResult.hitNormalWorld.z.toFixed(2)})`);
  } else {
    console.log(`  ❌ Manual raycast MISSED - no collision detected!`);
    console.log(`     From: (${testFrom.x.toFixed(2)}, ${testFrom.y.toFixed(2)}, ${testFrom.z.toFixed(2)})`);
    console.log(`     To: (${testTo.x.toFixed(2)}, ${testTo.y.toFixed(2)}, ${testTo.z.toFixed(2)})`);
    console.log(`     🔍 Ground body should be at Y=59.5, top at Y=60.0`);
  }

  // Warm-up: Run physics simulation silently for 30 steps to let suspension settle
  // This ensures wheels are in contact and car is stable before rendering starts
  console.log('⏳ Running warm-up physics steps...');
  const fixedTimeStep = 1 / 60;

  // Track velocity to detect UPWARD movement
  let prevY = chassisBody.position.y;

  for (let i = 0; i < 30; i++) {
    vehicle.updateVehicle(fixedTimeStep);
    world.step(fixedTimeStep);

    const currentY = chassisBody.position.y;
    const deltaY = currentY - prevY;

    // Debug: Log every 10 steps to see when pitch starts
    if (i % 10 === 0 || i === 29) {
      const wheelsIn = vehicle.wheelInfos.filter(w => w.isInContact).length;
      console.log(`  Step ${i}: wheels=${wheelsIn}/4, Y=${currentY.toFixed(2)}, ΔY=${deltaY.toFixed(3)}, velY=${chassisBody.velocity.y.toFixed(2)}`);

      // CRITICAL: Check if car is moving UPWARD
      if (deltaY > 0.01) {
        console.log(`    ⚠️  CAR IS BEING LAUNCHED UPWARD! ΔY=+${deltaY.toFixed(3)}m`);
      }

      // Extra debug on step 0 to verify raycast setup
      if (i === 0) {
        vehicle.wheelInfos.forEach((wheel, idx) => {
          const worldStart = new CANNON.Vec3();
          chassisBody.pointToWorldFrame(wheel.chassisConnectionPointLocal, worldStart);

          // Get the suspension force direction in world space
          const suspensionDir = new CANNON.Vec3();
          chassisBody.vectorToWorldFrame(wheel.directionLocal, suspensionDir);

          console.log(`    Wheel ${idx}: worldStart=(${worldStart.x.toFixed(2)}, ${worldStart.y.toFixed(2)}, ${worldStart.z.toFixed(2)})`);
          console.log(`              directionLocal=(${wheel.directionLocal.x.toFixed(2)}, ${wheel.directionLocal.y.toFixed(2)}, ${wheel.directionLocal.z.toFixed(2)}), directionWorld=(${suspensionDir.x.toFixed(2)}, ${suspensionDir.y.toFixed(2)}, ${suspensionDir.z.toFixed(2)})`);
          console.log(`              contact=${wheel.isInContact}, suspensionLen=${wheel.suspensionLength.toFixed(2)}m`);
        });
      }
    }

    prevY = currentY;
  }

  // Log final wheel contact status after warm-up
  const wheelsInContact = vehicle.wheelInfos.filter(w => w.isInContact).length;
  console.log(`✅ Warm-up complete: ${wheelsInContact}/4 wheels in contact`);
  vehicle.wheelInfos.forEach((wheel, i) => {
    console.log(`  Wheel ${i}: contact=${wheel.isInContact}, suspensionLength=${wheel.suspensionLength.toFixed(2)}m`);
  });

  return {
    world,
    vehicle,
    chassisBody,
    trackBodies,
    driftScore: 0,
    driftTime: 0,
    driftCombo: 0,
    track,
    spec,
    frameCount: 0,
  };
}

function createTrackCollision(world: CANNON.World, track: TrackSurface): CANNON.Body[] {
  const bodies: CANNON.Body[] = [];

  // Extract geometry from the Three.js mesh
  const geometry = track.mesh.geometry;
  const positionAttribute = geometry.getAttribute('position');
  const indexAttribute = geometry.getIndex();

  if (!positionAttribute || !indexAttribute) {
    console.error('Track mesh missing position or index attributes');
    return bodies;
  }

  // Convert Three.js geometry to Cannon.js format
  const vertices: number[] = [];
  const indices: number[] = [];

  // Extract vertices
  for (let i = 0; i < positionAttribute.count; i++) {
    vertices.push(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    );
  }

  // Debug: Log first few vertices to verify track position
  console.log('🔍 Track mesh first 3 vertices:');
  for (let i = 0; i < Math.min(3, positionAttribute.count); i++) {
    console.log(`  Vertex ${i}: (${positionAttribute.getX(i).toFixed(1)}, ${positionAttribute.getY(i).toFixed(1)}, ${positionAttribute.getZ(i).toFixed(1)})`);
  }

  // Extract indices and create double-sided triangles
  // Cannon.js Trimesh is single-sided, so we duplicate triangles with reversed winding
  for (let i = 0; i < indexAttribute.count; i += 3) {
    const i0 = indexAttribute.getX(i);
    const i1 = indexAttribute.getX(i + 1);
    const i2 = indexAttribute.getX(i + 2);

    // Original triangle (front face)
    indices.push(i0, i1, i2);

    // Reversed triangle (back face) - for double-sided collision
    indices.push(i0, i2, i1);
  }

  console.log(`🔧 Created double-sided trimesh: ${indices.length / 3} triangles (${indexAttribute.count / 3} original)`);

  // TEMPORARILY DISABLED: Trimesh collision is causing issues
  // TODO: Re-enable once vehicle is stable on flat plane
  /*
  // Create Trimesh shape
  const trimeshShape = new CANNON.Trimesh(vertices, indices);
  trimeshShape.collisionResponse = true;

  // Update normals and tree for better collision detection
  trimeshShape.updateNormals();
  trimeshShape.updateAABB();
  trimeshShape.updateBoundingSphereRadius();
  trimeshShape.updateTree();

  // Create static body with the trimesh
  const trackMaterial = new CANNON.Material('trackMaterial');

  const trackBody = new CANNON.Body({
    mass: 0, // Static
    shape: trimeshShape,
    material: trackMaterial,
    type: CANNON.Body.STATIC,
  });

  // The track geometry is already in world space, so no transformation needed
  trackBody.position.set(0, 0, 0);
  trackBody.quaternion.set(0, 0, 0, 1);

  world.addBody(trackBody);
  bodies.push(trackBody);
  */
  console.log('⚠️  Trimesh collision DISABLED for testing');

  // Create track material (moved outside trimesh block)
  const trackMaterial = new CANNON.Material('trackMaterial');

  // Ground heightfield - flat surface for testing
  // Heightfield is specifically designed for terrain/ground surfaces
  const startSample = track.getSampleAtDistance(0);

  // Create a simple 2x2 flat heightfield
  const matrix = [
    [0, 0],
    [0, 0],
  ];

  const groundShape = new CANNON.Heightfield(matrix, {
    elementSize: 100, // 100m per element = 200m x 200m total
  });

  const groundBody = new CANNON.Body({
    mass: 0,
    shape: groundShape,
    material: trackMaterial,
    type: CANNON.Body.STATIC,
  });

  // Position heightfield at track surface Y level
  // Heightfield is centered at origin, so offset by half size
  groundBody.position.set(-100, startSample.position.y, -100);

  // Rotate heightfield to be horizontal (default orientation needs -90° X rotation)
  const quat = new CANNON.Quaternion();
  quat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  groundBody.quaternion.copy(quat);

  world.addBody(groundBody);
  bodies.push(groundBody);
  console.log(`✓ Ground HEIGHTFIELD at Y=${startSample.position.y} (200m x 200m flat surface)`);

  // Create wheel material
  const wheelMaterial = new CANNON.Material('wheelMaterial');

  // Create contact material between wheels and track
  const wheelTrackContact = new CANNON.ContactMaterial(
    wheelMaterial,
    trackMaterial,
    {
      friction: 0.9,
      restitution: 0.0,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
    }
  );

  world.addContactMaterial(wheelTrackContact);

  console.log(`✓ Track collision: Using flat ground BOX only (Trimesh disabled for testing)`);

  return bodies;
}

export function stepCannonCar(
  state: CannonCarState,
  input: InputSnapshot,
  dt: number
): CarTelemetry {
  const { vehicle, chassisBody, world } = state;

  // Use fixed timestep for stability (max 60 FPS physics)
  const fixedTimeStep = 1 / 60;
  const maxSubSteps = 3;

  // Apply steering to front wheels
  const maxSteerVal = Math.PI / 6; // 30 degrees
  const steerValue = input.steer * maxSteerVal;
  vehicle.setSteeringValue(steerValue, 0); // Front left
  vehicle.setSteeringValue(steerValue, 1); // Front right

  // Apply throttle/brake
  const maxForce = 1500 + (state.spec.power * 500);
  const brakeForce = 1000;

  if (input.throttle > 0) {
    // Apply engine force to rear wheels
    vehicle.applyEngineForce(-maxForce * input.throttle, 2);
    vehicle.applyEngineForce(-maxForce * input.throttle, 3);
  } else {
    vehicle.applyEngineForce(0, 2);
    vehicle.applyEngineForce(0, 3);
  }

  if (input.brake > 0 || input.handbrake > 0) {
    const brake = Math.max(input.brake, input.handbrake);
    vehicle.setBrake(brakeForce * brake, 0);
    vehicle.setBrake(brakeForce * brake, 1);
    vehicle.setBrake(brakeForce * brake * 2, 2); // More brake on rear for handbrake
    vehicle.setBrake(brakeForce * brake * 2, 3);
  } else {
    vehicle.setBrake(0, 0);
    vehicle.setBrake(0, 1);
    vehicle.setBrake(0, 2);
    vehicle.setBrake(0, 3);
  }

  // Modify friction for drift control
  const baseFriction = 4;
  const driftFriction = 1.5 - (state.spec.driftControl * 0.2);

  if (input.handbrake > 0.5) {
    // Reduce rear wheel friction for drifting
    vehicle.wheelInfos[2].frictionSlip = driftFriction;
    vehicle.wheelInfos[3].frictionSlip = driftFriction;
  } else {
    // Normal friction
    vehicle.wheelInfos[0].frictionSlip = baseFriction;
    vehicle.wheelInfos[1].frictionSlip = baseFriction;
    vehicle.wheelInfos[2].frictionSlip = baseFriction;
    vehicle.wheelInfos[3].frictionSlip = baseFriction;
  }

  // Update vehicle (must be called before world.step for raycasts to work)
  vehicle.updateVehicle(fixedTimeStep);

  // Step physics with fixed timestep for stability
  world.step(fixedTimeStep, dt, maxSubSteps);

  // Increment frame counter
  state.frameCount++;

  // Debug logging (first 120 frames, every 20 frames)
  if (state.frameCount <= 120 && state.frameCount % 20 === 0) {
    const wheelsInContact = vehicle.wheelInfos.filter(w => w.isInContact).length;
    console.log(`🚗 Frame ${state.frameCount}:`, {
      pos: `(${chassisBody.position.x.toFixed(1)}, ${chassisBody.position.y.toFixed(1)}, ${chassisBody.position.z.toFixed(1)})`,
      vel: `(${chassisBody.velocity.x.toFixed(1)}, ${chassisBody.velocity.y.toFixed(1)}, ${chassisBody.velocity.z.toFixed(1)})`,
      quat: `(${chassisBody.quaternion.x.toFixed(2)}, ${chassisBody.quaternion.y.toFixed(2)}, ${chassisBody.quaternion.z.toFixed(2)}, ${chassisBody.quaternion.w.toFixed(2)})`,
      wheelsInContact: `${wheelsInContact}/4`,
      speed: `${chassisBody.velocity.length().toFixed(1)} m/s`,
    });

    // Log individual wheel states
    vehicle.wheelInfos.forEach((wheel, i) => {
      console.log(`  Wheel ${i}: contact=${wheel.isInContact}, suspensionLength=${wheel.suspensionLength.toFixed(2)}m`);
    });
  }

  // Calculate telemetry
  const carPos = new THREE.Vector3(
    chassisBody.position.x,
    chassisBody.position.y,
    chassisBody.position.z
  );

  const projection = state.track.projectPoint(carPos);
  const lateralOffset = carPos.clone().sub(projection.projected).dot(projection.sample.binormal);
  const trackWidth = projection.sample.width ?? 24;
  const clampLimit = Math.max(trackWidth * 0.5 - 1.2, 0.2);
  const clampedLateral = THREE.MathUtils.clamp(lateralOffset, -clampLimit, clampLimit);
  const velocity = chassisBody.velocity;
  const speed = velocity.length();

  // Get chassis orientation
  const forward = new CANNON.Vec3(0, 0, 1);
  chassisBody.quaternion.vmult(forward, forward);

  // Calculate slip angle (angle between velocity and forward direction)
  const velAngle = Math.atan2(velocity.z, velocity.x);
  const forwardAngle = Math.atan2(forward.z, forward.x);
  let slipAngle = forwardAngle - velAngle;

  // Normalize to -PI to PI
  while (slipAngle > Math.PI) slipAngle -= Math.PI * 2;
  while (slipAngle < -Math.PI) slipAngle += Math.PI * 2;

  const slipAngleDeg = Math.abs(slipAngle * 180 / Math.PI);
  const driftActive = slipAngleDeg > 20 && speed > 10;

  // Calculate yaw rate
  const angularVel = chassisBody.angularVelocity;
  const yawRate = angularVel.y;

  // Drift scoring
  if (driftActive) {
    state.driftTime += dt;
    state.driftCombo = Math.min(state.driftCombo + dt, 5);
    const comboMultiplier = 1 + state.driftCombo * 0.15;
    state.driftScore += dt * comboMultiplier;
  } else {
    state.driftTime = Math.max(0, state.driftTime - dt * 2);
    state.driftCombo = Math.max(0, state.driftCombo - dt * 3);
  }

  return {
    speed,
    slipAngleDeg,
    driftActive,
    driftStateName: driftActive ? 'DRIFT' : 'GRIP',
    assistStrength: 0,
    score: state.driftScore,
    gradePercent: projection.sample.tangent.y * 100,
    driftTime: state.driftTime,
    progress: projection.sample.distance,
    lateralOffset: clampedLateral,
    steerAngleDeg: steerValue * 180 / Math.PI,
    yawRateDeg: yawRate * 180 / Math.PI,
    steerInput: input.steer,
    throttle: input.throttle,
    brake: input.brake,
    handbrake: input.handbrake,
    longitudinalSpeed: speed,
    lateralSpeed: 0,
    frontSlipDeg: slipAngleDeg,
    rearSlipDeg: slipAngleDeg,
  };
}

// Helper to get position and quaternion for visual update
export function getCannonCarTransform(state: CannonCarState): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
} {
  const pos = state.chassisBody.position;
  const quat = state.chassisBody.quaternion;

  return {
    position: new THREE.Vector3(pos.x, pos.y, pos.z),
    quaternion: new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
  };
}
