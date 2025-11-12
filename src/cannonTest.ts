import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createMountainTrack } from './track';
import { createTrackCollisionBodies, createRaycastRibbon, createTrackMaterial, createTrackWalls, visualizeCollisionBodies } from './trackCollision';
import { castRaySmooth, useSmoothRaycasts } from './smoothRaycast';
import { calculateVehicleTelemetry, formatTelemetryHUD, type VehicleTelemetry } from './telemetry';
import { getVehicleConfig, describeVehicle, type VehicleConfigKey } from './vehicleConfig';

// ============================================================================
// CANNON-ES VEHICLE TEST - MOUNTAIN TRACK
// RaycastVehicle on touge track with TWO-LAYER collision system
// ============================================================================

// Debug counter for limiting console spam
let vehicleDebugFrames = 0;

// COLLISION GROUPS for two-layer system
const CHASSIS_GROUP = 1;      // Chassis body
const MAIN_GROUND_GROUP = 2;  // Main collision boxes (chassis safety net)
const RAYCAST_GROUP = 4;      // Smooth ribbon for wheel raycasts only

export function runCannonTest() {
  console.log('🧪 Starting cannon-es vehicle test on mountain track...');

  // ============================================================================
  // VEHICLE CONFIGURATION
  // ============================================================================

  let currentConfigKey: VehicleConfigKey = 'proto'; // Start with prototype
  let vehicleConfig = getVehicleConfig(currentConfigKey);
  let showDetailedTelemetry = true; // Toggle with 'T' key

  console.log('🚗 Vehicle configuration:');
  console.log(describeVehicle(vehicleConfig));

  // ============================================================================
  // THREE.JS SETUP
  // ============================================================================

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky blue

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 10, 20);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Add HUD
  const hudDiv = document.createElement('div');
  hudDiv.style.position = 'absolute';
  hudDiv.style.top = '20px';
  hudDiv.style.left = '20px';
  hudDiv.style.color = 'white';
  hudDiv.style.fontFamily = 'monospace';
  hudDiv.style.fontSize = '16px';
  hudDiv.style.background = 'rgba(0,0,0,0.5)';
  hudDiv.style.padding = '10px';
  hudDiv.style.borderRadius = '5px';
  document.body.appendChild(hudDiv);

  // Lighting - VERY BRIGHT for debugging visibility
  const ambientLight = new THREE.AmbientLight(0xffffff, 2.0); // Increased from 0.6 to 2.0
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Create mountain track
  const track = createMountainTrack();
  scene.add(track.mesh);
  console.log(`🏔️ Mountain track created: ${track.totalLength.toFixed(0)}m long, ${track.samples.length} samples`);

  // Add fog for atmosphere
  scene.fog = new THREE.Fog(0x87ceeb, 50, 500);

  // Car visual - 2-door coupe/sedan shape (SLAMMED stance)
  const carGroup = new THREE.Group();

  // Main body (lower part) - SLAMMED between wheels
  const bodyGeometry = new THREE.BoxGeometry(
    vehicleConfig.chassis.halfWidth * 2,
    vehicleConfig.chassis.halfHeight * 0.8, // Even thinner body
    vehicleConfig.chassis.halfLength * 2
  );
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
  bodyMesh.position.y = -0.50; // SLAMMED - way lower, almost touching ground
  bodyMesh.castShadow = true;
  carGroup.add(bodyMesh);

  // Cabin/windshield (upper part) - positioned toward rear like coupe
  const cabinGeometry = new THREE.BoxGeometry(
    vehicleConfig.chassis.halfWidth * 1.8, // Slightly narrower
    vehicleConfig.chassis.halfHeight * 0.6, // Lower cabin
    vehicleConfig.chassis.halfLength * 0.75  // Shorter cabin
  );
  const cabinMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222, // Dark windows/cabin
    metalness: 0.3,
    roughness: 0.7
  });
  const cabinMesh = new THREE.Mesh(cabinGeometry, cabinMaterial);
  cabinMesh.position.y = -0.05; // Sits on slammed body
  cabinMesh.position.z = -0.3; // Slightly toward rear (coupe style)
  cabinMesh.castShadow = true;
  carGroup.add(cabinMesh);

  // Hood/front area (slight wedge shape with taper)
  const hoodGeometry = new THREE.BoxGeometry(
    vehicleConfig.chassis.halfWidth * 2,
    vehicleConfig.chassis.halfHeight * 0.3,
    vehicleConfig.chassis.halfLength * 0.6
  );
  const hoodMesh = new THREE.Mesh(hoodGeometry, bodyMaterial);
  hoodMesh.position.y = -0.30; // Slammed hood
  hoodMesh.position.z = 1.2; // Front of car
  hoodMesh.castShadow = true;
  carGroup.add(hoodMesh);

  scene.add(carGroup);
  const carMesh = carGroup; // Use group as main mesh for position updates

  // Wheel visuals (using config radius)
  const wheelGeometry = new THREE.CylinderGeometry(
    vehicleConfig.wheels.radius,
    vehicleConfig.wheels.radius,
    0.3,
    16
  );
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const wheelMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheelMesh.castShadow = true;
    scene.add(wheelMesh);
    wheelMeshes.push(wheelMesh);
  }


  // ============================================================================
  // CANNON-ES PHYSICS SETUP
  // ============================================================================

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0),
  });

  // Improve solver for better collision detection (prevents tunneling)
  world.solver.iterations = 20; // More iterations = more accurate (default: 10)
  world.allowSleep = true; // Allow objects to sleep when at rest
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 4;

  // Create track collision material
  const trackMaterial = createTrackMaterial({
    friction: 0.7,
    restitution: 0.0,
  });

  // Create guardrail material - ARCADE STYLE: Disabled collision response
  const guardrailMaterial = new CANNON.Material('guardrail');

  // Contact material with ZERO collision response - we handle it manually
  const carGuardrailContact = new CANNON.ContactMaterial(
    world.defaultMaterial,
    guardrailMaterial,
    {
      friction: 0,
      restitution: 0,
      contactEquationStiffness: 0,      // NO collision response
      contactEquationRelaxation: 100,   // Extremely relaxed
    }
  );
  world.addContactMaterial(carGuardrailContact);

  // SMOOTH WEDGE COLLISION - Continuous slopes, no stepping!
  // Each wedge spans two consecutive track samples
  // Top surface forms a continuous slope - wheel raycasts never see discontinuities
  const trackBodies = createTrackCollisionBodies(track, world, {
    segmentLength: 0.8,    // 0.8m spacing - balanced performance
    thickness: 1.5,        // Thick enough for collision tolerance
    material: trackMaterial,
  });

  // DEBUG: Visualize collision boxes (toggle with 'V' key)
  let collisionWireframes: THREE.LineSegments[] = [];
  let showCollisionDebug = false;

  // Add SMART guardrails - curvature-adaptive placement
  // Tighter spacing on corners to prevent gaps on outside of curve
  const guardrailBodies: CANNON.Body[] = [];
  const wallHeight = 1.0; // 1m tall barriers
  const curvatureThreshold = 0.15; // Detect tight corners

  let wallDistanceCounter = 0;

  for (let i = 0; i < track.samples.length - 1; i++) {
    const sample = track.samples[i];

    // Pre-calculate curvature to determine spacing
    const lookAhead = Math.min(30, track.samples.length - 1 - i);
    const nextIndex = i + lookAhead;
    const nextSample = track.samples[nextIndex];
    const tangentDot = sample.tangent.dot(nextSample.tangent);
    const curvatureAngle = Math.acos(Math.max(-1, Math.min(1, tangentDot)));
    const isTightCorner = curvatureAngle > curvatureThreshold;

    // Adaptive spacing: much tighter on corners to prevent gaps on outside
    const wallSpacing = isTightCorner ? 3 : 6; // 3m on tight corners, 6m on straights

    if (sample.distance >= wallDistanceCounter) {
      // Determine turn direction: sign of (t_i × t_{i+1}) · up
      const tangentCross = new THREE.Vector3().crossVectors(sample.tangent, nextSample.tangent);
      const turnDirection = Math.sign(tangentCross.dot(sample.normal)); // +1 = left turn, -1 = right turn

      // Create orientation from track geometry
      const rotationMatrix = new THREE.Matrix4().makeBasis(
        sample.binormal,     // X: across track
        sample.normal,       // Y: up
        sample.tangent       // Z: along track
      );
      const threeQuat = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
      const orientation = new CANNON.Quaternion(
        threeQuat.x,
        threeQuat.y,
        threeQuat.z,
        threeQuat.w
      );

      // Place guardrails flush with track edge (no gap)
      // Guardrail box width is 0.3m (0.15m half-extent), so center at edge + 0.15m
      const wallOffset = (track.width * 0.5) + 0.15; // Flush against track edge

      // Dynamic segment length based on curvature - MUCH shorter on corners to reduce swing
      const wallSegmentLength = isTightCorner ? 5 : 8; // 5m on tight corners, 8m on straights

      // ALWAYS place both guardrails for full coverage
      // Shorter segments on corners prevent them from swinging into the track

      // Left guardrail (binormal direction = +1)
      const leftShape = new CANNON.Box(new CANNON.Vec3(0.15, wallHeight * 0.5, wallSegmentLength * 0.5));
      leftShape.material = guardrailMaterial;
      const leftBody = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        quaternion: orientation,
        collisionResponse: false, // ARCADE: No physical collision - distance-based only
      });
      leftBody.addShape(leftShape);
      leftBody.position.set(
        sample.position.x + sample.binormal.x * wallOffset,
        sample.position.y + wallHeight * 0.5,
        sample.position.z + sample.binormal.z * wallOffset
      );
      world.addBody(leftBody);
      guardrailBodies.push(leftBody);

      // Right guardrail (binormal direction = -1)
      const rightShape = new CANNON.Box(new CANNON.Vec3(0.15, wallHeight * 0.5, wallSegmentLength * 0.5));
      rightShape.material = guardrailMaterial;
      const rightBody = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        quaternion: orientation,
        collisionResponse: false, // ARCADE: No physical collision - distance-based only
      });
      rightBody.addShape(rightShape);
      rightBody.position.set(
        sample.position.x - sample.binormal.x * wallOffset,
        sample.position.y + wallHeight * 0.5,
        sample.position.z - sample.binormal.z * wallOffset
      );
      world.addBody(rightBody);
      guardrailBodies.push(rightBody);

      // Debug logging for first few and tight corners
      if (i < 5 || (isTightCorner && Math.random() < 0.3)) {
        const turnType = turnDirection > 0 ? 'LEFT' : turnDirection < 0 ? 'RIGHT' : 'STRAIGHT';
        const spacing = wallSpacing;
        const segLen = wallSegmentLength;
        console.log(`  Segment ${i}: curvature ${curvatureAngle.toFixed(3)} rad → ${turnType} turn, spacing ${spacing}m, length ${segLen}m`);
      }

      wallDistanceCounter += wallSpacing;
    }
  }

  console.log(`✅ Guardrails: ${guardrailBodies.length} segments (adaptive: 3m/5m on corners, 6m/8m on straights, flush with track edge)`);

  // ============================================================================
  // DEBUG VISUALIZATION - Collision Boxes
  // ============================================================================

  const collisionBoxHelpers: THREE.LineSegments[] = [];

  function createCollisionBoxHelpers() {
    // Clear existing helpers
    collisionBoxHelpers.forEach(helper => scene.remove(helper));
    collisionBoxHelpers.length = 0;

    // Create helpers for track wedges (green)
    trackBodies.forEach((body) => {
      if (body.shapes[0] instanceof CANNON.Box) {
        const shape = body.shapes[0] as CANNON.Box;
        const geometry = new THREE.BoxGeometry(
          shape.halfExtents.x * 2,
          shape.halfExtents.y * 2,
          shape.halfExtents.z * 2
        );
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({
          color: 0x00ff00,  // Green for track collision
          linewidth: 2
        });
        const helper = new THREE.LineSegments(edges, material);
        helper.position.copy(body.position as any);
        helper.quaternion.copy(body.quaternion as any);
        helper.visible = false; // Hidden by default
        scene.add(helper);
        collisionBoxHelpers.push(helper);
      }
    });

    // Create helpers for guardrail collision bodies (red)
    guardrailBodies.forEach((body) => {
      if (body.shapes[0] instanceof CANNON.Box) {
        const shape = body.shapes[0] as CANNON.Box;
        const geometry = new THREE.BoxGeometry(
          shape.halfExtents.x * 2,
          shape.halfExtents.y * 2,
          shape.halfExtents.z * 2
        );
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({
          color: 0xff0000,  // Red for guardrails
          linewidth: 1
        });
        const helper = new THREE.LineSegments(edges, material);
        helper.position.copy(body.position as any);
        helper.quaternion.copy(body.quaternion as any);
        helper.visible = false; // Hidden by default
        scene.add(helper);
        collisionBoxHelpers.push(helper);
      }
    });

    console.log(`🎨 Created ${collisionBoxHelpers.length} collision box helpers (Press B to toggle)`);
  }

  createCollisionBoxHelpers();

  // Step the world once to initialize collision detection
  world.step(1/60);

  // Car chassis body (using config)
  const chassisShape = new CANNON.Box(new CANNON.Vec3(
    vehicleConfig.chassis.halfWidth,
    vehicleConfig.chassis.halfHeight,
    vehicleConfig.chassis.halfLength
  ));
  const chassisBody = new CANNON.Body({
    mass: vehicleConfig.chassis.mass,
    shape: chassisShape,
    angularDamping: vehicleConfig.dynamics.angularDamping,
    linearDamping: vehicleConfig.dynamics.linearDamping,
    collisionFilterGroup: CHASSIS_GROUP,
    collisionFilterMask: ~MAIN_GROUND_GROUP, // Don't collide with track boxes (smooth raycasting handles wheels)
  });

  // Center of mass from config
  chassisBody.centerOfMassOffset = vehicleConfig.chassis.centerOfMassOffset;

  // Spawn car at track start, moved forward to ensure it's on a collision box
  const startSample = track.samples[10]; // Use sample 10 instead of 0 to ensure on collision box
  const startPos = startSample.position;
  const startTangent = startSample.tangent;

  // Spawn chassis at perfect rest height for smooth raycasting
  // Height = wheel attachment point + suspension rest length + wheel radius (no extra margin - suspension will settle naturally)
  const wheelConnectionY = Math.abs(vehicleConfig.wheels.positions[0].y);
  const spawnHeight = vehicleConfig.wheels.radius + vehicleConfig.suspension.restLength + wheelConnectionY;
  chassisBody.position.set(startPos.x, startPos.y + spawnHeight, startPos.z);

  console.log(`📐 Spawn calc: wheelAttach=${wheelConnectionY.toFixed(2)}m + suspRest=${vehicleConfig.suspension.restLength.toFixed(2)}m + wheelRadius=${vehicleConfig.wheels.radius.toFixed(2)}m = ${spawnHeight.toFixed(2)}m above track`);

  // Orient car along track tangent
  const startYaw = Math.atan2(startTangent.x, startTangent.z);
  chassisBody.quaternion.setFromEuler(0, startYaw, 0);

  world.addBody(chassisBody);

  // CRITICAL: Initialize car mesh position/rotation to match physics spawn
  // This prevents lerp/slerp from interpolating from origin (0,0,0) on first frame
  carMesh.position.copy(chassisBody.position as any);
  carMesh.quaternion.copy(chassisBody.quaternion as any);

  console.log(`🚗 Chassis spawned at Y=${(startPos.y + spawnHeight).toFixed(1)} (gentle drop to track at Y=${startPos.y.toFixed(1)})`);
  console.log(`🎨 Car mesh initial position: (${carMesh.position.x.toFixed(1)}, ${carMesh.position.y.toFixed(1)}, ${carMesh.position.z.toFixed(1)})`);

  // Initialize camera position behind car
  const initialCameraOffset = new THREE.Vector3(0, 5, -15);
  const initialCameraPos = new THREE.Vector3().copy(carMesh.position).add(initialCameraOffset);
  camera.position.copy(initialCameraPos);
  camera.lookAt(carMesh.position);
  console.log(`📷 Camera initialized at: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`);

  // Create RaycastVehicle
  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,   // X
    indexUpAxis: 1,      // Y
    indexForwardAxis: 2, // Z
  });

  // Add wheels (using config)
  const wheelOptions = {
    radius: vehicleConfig.wheels.radius,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: vehicleConfig.suspension.stiffness,
    suspensionRestLength: vehicleConfig.suspension.restLength,
    frictionSlip: vehicleConfig.tire.frictionSlip,
    dampingRelaxation: vehicleConfig.suspension.dampingRelaxation,
    dampingCompression: vehicleConfig.suspension.dampingCompression,
    maxSuspensionForce: vehicleConfig.suspension.maxForce,
    rollInfluence: vehicleConfig.tire.rollInfluence,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
    maxSuspensionTravel: vehicleConfig.suspension.maxTravel,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  vehicleConfig.wheels.positions.forEach((position) => {
    vehicle.addWheel({
      ...wheelOptions,
      chassisConnectionPointLocal: position,
    });
  });

  vehicle.addToWorld(world);

  // Override castRay with smooth track raycasting
  // This clones CANNON's logic but uses mesh intersection instead of physics bodies
  const originalCastRay = vehicle.castRay.bind(vehicle);
  vehicle.castRay = (wheelInfo: any) => {
    if (useSmoothRaycasts) {
      const depth = castRaySmooth(vehicle, wheelInfo, track);
      if (depth >= 0) {
        return depth; // Smooth raycast succeeded
      }
    }
    // Fallback to CANNON's box collision
    return originalCastRay(wheelInfo);
  };

  console.log(`✅ Vehicle ready: ${vehicleConfig.name} (${vehicleConfig.chassis.mass}kg, ${vehicle.wheelInfos.length} wheels)`);
  console.log(`✨ Smooth track raycasting: ${useSmoothRaycasts ? 'ENABLED' : 'DISABLED'}`);

  // ============================================================================
  // ARCADE GUARDRAIL PHYSICS - Distance-Based Wall Assist
  // ============================================================================
  // Uses track projection to detect wall proximity and apply arcade-style graze
  // Runs in preStep so corrections happen BEFORE physics solver

  const trackEdge = track.width * 0.5; // 6m from center = track edge
  const wallZone = trackEdge - 0.2; // Trigger bounce 20cm BEFORE edge (prevents clipping through guardrail)

  world.addEventListener('preStep', () => {
    // Project chassis position onto track to get lateral offset
    const carPos = new THREE.Vector3(
      chassisBody.position.x,
      chassisBody.position.y,
      chassisBody.position.z
    );

    const projection = track.projectPoint(carPos);
    const sample = projection.sample;

    // ========================================================================
    // ARCADE STABILIZATION: Keep car upright (prevent rolling/pitching)
    // ========================================================================

    // Get car's current orientation
    const carQuat = chassisBody.quaternion;
    const upVector = new CANNON.Vec3(0, 1, 0);
    const carUp = new CANNON.Vec3();
    carQuat.vmult(upVector, carUp); // Car's local "up" in world space

    // Calculate how tilted the car is
    const tiltDot = carUp.dot(upVector); // 1.0 = upright, 0.0 = on side, -1.0 = upside down

    if (tiltDot < 0.95) {
      // Car is tilted - apply strong corrective torque
      // Calculate axis to rotate around (perpendicular to both up vectors)
      const correctionAxis = new CANNON.Vec3();
      carUp.cross(upVector, correctionAxis);
      correctionAxis.normalize();

      // Strong stabilization torque (like a gyroscope)
      const stabilizationStrength = 50.0; // Very strong for arcade feel
      const correctionTorque = correctionAxis.scale(stabilizationStrength);

      // Apply torque to right the car
      chassisBody.torque.vadd(correctionTorque, chassisBody.torque);

      // Dampen angular velocity when tilted (prevents oscillation)
      chassisBody.angularVelocity.scale(0.5, chassisBody.angularVelocity);
    }

    // Auto-correct if car is severely tilted or upside down
    if (tiltDot < 0.3) {
      // Car is on its side or upside down - snap it upright
      const targetQuat = new CANNON.Quaternion();
      targetQuat.setFromEuler(0, Math.atan2(sample.tangent.x, sample.tangent.z), 0);
      chassisBody.quaternion.copy(targetQuat);
      chassisBody.angularVelocity.set(0, 0, 0);
    }

    // ========================================================================
    // WALL COLLISION: Arcade graze behavior
    // ========================================================================

    // Calculate lateral offset from track centerline
    const toCarVec = new THREE.Vector3().subVectors(carPos, sample.position);
    const lateralOffset = toCarVec.dot(sample.binormal);

    // Check if car is outside track bounds
    const absOffset = Math.abs(lateralOffset);
    if (absOffset > wallZone) {
      // INSTANT SNAP BACK: Teleport car to safe zone (away from guardrail)
      const wallSign = Math.sign(lateralOffset);
      const safeZone = trackEdge - 0.8; // 5.2m from center - well within track bounds
      const safePos = sample.position.clone().add(
        sample.binormal.clone().multiplyScalar(wallSign * safeZone)
      );

      // Snap position to safe zone (keep original Y height)
      chassisBody.position.set(safePos.x, carPos.y, safePos.z);

      // ARCADE VELOCITY: Speed-dependent bounce
      const velocity = chassisBody.velocity;
      const vel3 = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
      const wallNormal = sample.binormal.clone().multiplyScalar(wallSign);

      // Get velocity along track (tangent direction)
      const trackForward = sample.tangent;
      const forwardSpeed = vel3.dot(trackForward);
      const forwardVel = trackForward.clone().multiplyScalar(forwardSpeed * 0.95); // Keep 95% forward speed

      // SPEED-DEPENDENT BOUNCE: Faster car = stronger bounce, slower car = gentle push
      const currentSpeed = Math.abs(forwardSpeed);

      // Much gentler at low speeds
      const minBounce = 0.3;  // Very gentle at crawling speeds (barely noticeable)
      const maxBounce = 6.0;  // Strong bounce at high speeds

      // Non-linear scaling: speed² makes low speeds even gentler
      const speedFactor = Math.min(currentSpeed / 25.0, 1.0); // 25 m/s = max bounce
      const quadraticFactor = speedFactor * speedFactor; // Square it for more dramatic difference
      const bounceSpeed = minBounce + (maxBounce - minBounce) * quadraticFactor;
      const bounceVel = wallNormal.clone().multiplyScalar(-bounceSpeed);

      // New velocity: forward motion + gentle bounce
      const newVel = forwardVel.add(bounceVel);

      // Keep some Y velocity for jumps/drops
      newVel.y = velocity.y * 0.5;

      velocity.set(newVel.x, newVel.y, newVel.z);

      // Dampen angular velocity (stabilization will handle the rest)
      chassisBody.angularVelocity.scale(0.2, chassisBody.angularVelocity);
    }
  });

  // ============================================================================
  // DEBUG CAMERA CONTROLS
  // ============================================================================

  let debugCameraMode = false; // Toggle between vehicle cam and free cam
  let showCollisionBoxes = false; // Toggle collision box visualization

  // Free camera state
  const freeCameraPosition = new THREE.Vector3(0, 100, 100);
  const freeCameraRotation = { yaw: 0, pitch: 0 }; // Euler angles
  const freeCameraVelocity = new THREE.Vector3();
  const freeCameraInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    sprint: false,
  };

  // Mouse look for free camera
  let isMouseLookActive = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // FPS-style mouse look with pointer lock
  const canvas = renderer.domElement;

  canvas.addEventListener('click', () => {
    if (debugCameraMode) {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isMouseLookActive = document.pointerLockElement === canvas;
    if (!isMouseLookActive && debugCameraMode) {
      // User pressed ESC - exit debug camera mode
      debugCameraMode = false;
      console.log('🎥 Switched to vehicle camera');
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isMouseLookActive && debugCameraMode) {
      const deltaX = e.movementX || 0;
      const deltaY = e.movementY || 0;

      freeCameraRotation.yaw -= deltaX * 0.002; // Horizontal rotation (move right = rotate right)
      freeCameraRotation.pitch -= deltaY * 0.002; // Vertical rotation (move down = look down)
      freeCameraRotation.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, freeCameraRotation.pitch));
    }
  });

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  const input = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
  };

  window.addEventListener('keydown', (e) => {
    // Debug camera controls (active when in debug mode)
    if (debugCameraMode) {
      switch (e.key.toLowerCase()) {
        case 'w': freeCameraInput.forward = true; break;
        case 's': freeCameraInput.backward = true; break;
        case 'a': freeCameraInput.left = true; break;
        case 'd': freeCameraInput.right = true; break;
        case 'q': freeCameraInput.down = true; break;
        case 'e': freeCameraInput.up = true; break;
        case 'shift': freeCameraInput.sprint = true; break;
      }
    }

    // Vehicle controls and global toggles
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        if (!debugCameraMode) input.forward = true;
        break;
      case 's':
      case 'arrowdown':
        if (!debugCameraMode) input.backward = true;
        break;
      case 'a':
      case 'arrowleft':
        if (!debugCameraMode) input.left = true;
        break;
      case 'd':
      case 'arrowright':
        if (!debugCameraMode) input.right = true;
        break;
      case ' ':
        if (!debugCameraMode) input.brake = true;
        break;
      case 'c':
        // Toggle debug camera mode
        debugCameraMode = !debugCameraMode;
        if (debugCameraMode) {
          // Start free camera at current vehicle position
          freeCameraPosition.copy(camera.position);
          // Auto-request pointer lock for FPS-style mouse look
          canvas.requestPointerLock();
          console.log(`📷 DEBUG CAMERA: ON - Mouse to look, WASD to move, QE for up/down, Shift to sprint, ESC to exit`);
        } else {
          // Exit pointer lock when leaving debug mode
          if (document.pointerLockElement === canvas) {
            document.exitPointerLock();
          }
          console.log(`📷 DEBUG CAMERA: OFF - Back to vehicle camera`);
        }
        break;
      case 'b':
        // Toggle collision box visualization
        showCollisionBoxes = !showCollisionBoxes;
        collisionBoxHelpers.forEach(helper => {
          helper.visible = showCollisionBoxes;
        });
        console.log(`📦 COLLISION BOXES: ${showCollisionBoxes ? 'VISIBLE' : 'HIDDEN'}`);
        break;
      case 't':
        // Toggle telemetry detail
        showDetailedTelemetry = !showDetailedTelemetry;
        console.log(`📊 Telemetry detail: ${showDetailedTelemetry ? 'FULL' : 'COMPACT'}`);
        break;
      case 'v':
        // Cycle vehicle config
        const keys: VehicleConfigKey[] = ['proto', 'ae86', 's13'];
        const currentIndex = keys.indexOf(currentConfigKey);
        const nextIndex = (currentIndex + 1) % keys.length;
        currentConfigKey = keys[nextIndex];
        vehicleConfig = getVehicleConfig(currentConfigKey);
        console.log('🚗 Switched vehicle config:');
        console.log(describeVehicle(vehicleConfig));
        console.log('⚠️  Note: Config change requires restart to take effect');
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    // Debug camera keyup
    if (debugCameraMode) {
      switch (e.key.toLowerCase()) {
        case 'w': freeCameraInput.forward = false; break;
        case 's': freeCameraInput.backward = false; break;
        case 'a': freeCameraInput.left = false; break;
        case 'd': freeCameraInput.right = false; break;
        case 'q': freeCameraInput.down = false; break;
        case 'e': freeCameraInput.up = false; break;
        case 'shift': freeCameraInput.sprint = false; break;
      }
    }

    // Vehicle controls keyup
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        input.forward = false;
        break;
      case 's':
      case 'arrowdown':
        input.backward = false;
        break;
      case 'a':
      case 'arrowleft':
        input.left = false;
        break;
      case 'd':
      case 'arrowright':
        input.right = false;
        break;
      case ' ':
        input.brake = false;
        break;
    }
  });

  // ============================================================================
  // ANIMATION LOOP
  // ============================================================================

  let lastTime = performance.now();
  let hasLanded = false;
  let frameCount = 0;
  let lastLogTime = 0;
  let lastAirborneLog = 0;

  function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Apply vehicle controls (using config)
    const maxSteerVal = vehicleConfig.power.maxSteerAngle;
    const maxForce = vehicleConfig.power.maxEngineForce;
    const brakeForce = vehicleConfig.power.maxBrakeForce;

    let steerValue = 0;
    if (input.left) steerValue += maxSteerVal;
    if (input.right) steerValue -= maxSteerVal;

    vehicle.setSteeringValue(steerValue, 0); // Front-left
    vehicle.setSteeringValue(steerValue, 1); // Front-right

    let engineForce = 0;
    if (input.forward) engineForce = -maxForce; // Negative for forward
    if (input.backward) engineForce = maxForce;  // Positive for backward

    // Debug: Log input state once per second
    if (Math.floor(performance.now() / 1000) !== Math.floor((performance.now() - 16) / 1000)) {
      const wheelsInContact = vehicle.wheelInfos.filter((w: any) => w.isInContact).length;
      console.log(`🎮 Input: fwd=${input.forward}, back=${input.backward}, left=${input.left}, right=${input.right} | Force=${engineForce.toFixed(0)} | Wheels=${wheelsInContact}/4 | Steer=${steerValue.toFixed(2)}`);
    }

    vehicle.applyEngineForce(engineForce, 2); // Rear-left
    vehicle.applyEngineForce(engineForce, 3); // Rear-right

    if (input.brake) {
      // Handbrake: Subtle rear-only braking for drift initiation
      // Much lighter than full brake - just breaks rear traction
      const handbrakeForce = brakeForce * 0.15; // Only 15% of full brake force
      vehicle.setBrake(0, 0); // Front-left (no brake)
      vehicle.setBrake(0, 1); // Front-right (no brake)
      vehicle.setBrake(handbrakeForce, 2); // Rear-left (light)
      vehicle.setBrake(handbrakeForce, 3); // Rear-right (light)
    } else {
      vehicle.setBrake(0, 0);
      vehicle.setBrake(0, 1);
      vehicle.setBrake(0, 2);
      vehicle.setBrake(0, 3);
    }

    // Expose to global for manual inspection
    (window as any).debugVehicle = vehicle;

    // Update physics
    vehicle.updateVehicle(1 / 60);

    world.step(1 / 60, deltaTime, 3);

    // CRITICAL: Calculate telemetry BEFORE updating wheel visuals!
    // updateWheelTransform() resets isInContact to false, so we must read it first
    const telemetry = calculateVehicleTelemetry(vehicle, chassisBody);

    // DEBUG: Track wheel contact loss
    const contactCount = telemetry.wheels.filter(w => w.isInContact).length;
    if (contactCount < 4) {
      const lostWheels = telemetry.wheels
        .map((w, i) => w.isInContact ? null : i)
        .filter(i => i !== null);
      const position = chassisBody.position;
      const velocity = chassisBody.velocity;
      console.warn(
        `⚠️ WHEEL CONTACT LOSS: ${contactCount}/4 wheels on ground | ` +
        `Lost wheels: ${lostWheels.join(', ')} | ` +
        `Position: (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}) | ` +
        `Speed: ${velocity.length().toFixed(1)} m/s | ` +
        `Suspension lengths: [${telemetry.wheels.map(w => w.suspensionLength.toFixed(3)).join(', ')}]`
      );
    }

    // Update visuals from physics with smoothing to reduce jitter
    // Interpolate position for smoother visual (lerp factor 0.8 = very responsive, minimal lag)
    const targetPosition = new THREE.Vector3().copy(chassisBody.position as any);
    carMesh.position.lerp(targetPosition, 0.8);
    const targetQuaternion = new THREE.Quaternion().copy(chassisBody.quaternion as any);
    carMesh.quaternion.slerp(targetQuaternion, 0.8);

    // Update wheel visuals
    vehicle.wheelInfos.forEach((wheel, i) => {
      vehicle.updateWheelTransform(i);
      const transform = wheel.worldTransform;
      wheelMeshes[i].position.copy(transform.position as any);
      wheelMeshes[i].quaternion.copy(transform.quaternion as any);
    });

    // Camera control
    if (debugCameraMode) {
      // FREE CAMERA MODE - WASD + mouse look
      const moveSpeed = freeCameraInput.sprint ? 100 : 30; // m/s
      const damping = 0.9;

      // Calculate forward and right vectors from yaw/pitch (FPS-style)
      // Extract the camera's actual look direction
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyEuler(new THREE.Euler(freeCameraRotation.pitch, freeCameraRotation.yaw, 0, 'YXZ'));

      // Right is perpendicular to forward on the horizontal plane
      const right = new THREE.Vector3(1, 0, 0);
      right.applyEuler(new THREE.Euler(0, freeCameraRotation.yaw, 0, 'YXZ'));
      const up = new THREE.Vector3(0, 1, 0);

      // Apply input to velocity
      const inputVelocity = new THREE.Vector3();
      if (freeCameraInput.forward) inputVelocity.add(forward);
      if (freeCameraInput.backward) inputVelocity.sub(forward);
      if (freeCameraInput.left) inputVelocity.sub(right);
      if (freeCameraInput.right) inputVelocity.add(right);
      if (freeCameraInput.up) inputVelocity.add(up);
      if (freeCameraInput.down) inputVelocity.sub(up);

      if (inputVelocity.length() > 0) {
        inputVelocity.normalize().multiplyScalar(moveSpeed);
      }

      // Apply velocity with damping
      freeCameraVelocity.multiplyScalar(damping);
      freeCameraVelocity.add(inputVelocity.multiplyScalar(1 - damping));

      // Update position
      freeCameraPosition.add(freeCameraVelocity.clone().multiplyScalar(deltaTime));

      // Apply to camera
      camera.position.copy(freeCameraPosition);
      camera.quaternion.setFromEuler(
        new THREE.Euler(freeCameraRotation.pitch, freeCameraRotation.yaw, 0, 'YXZ')
      );
    } else {
      // VEHICLE CAMERA MODE - Follow car from behind
      const cameraOffset = new THREE.Vector3(0, 5, -15); // Behind car (local space)
      const cameraPosition = cameraOffset.clone()
        .applyQuaternion(carMesh.quaternion) // Rotate offset by car's orientation
        .add(carMesh.position); // Add car position
      camera.position.lerp(cameraPosition, 0.1);

      // Look at a point slightly ahead of the car
      const lookAtPoint = new THREE.Vector3(0, 1, 3) // Slightly ahead
        .applyQuaternion(carMesh.quaternion)
        .add(carMesh.position);
      camera.lookAt(lookAtPoint);
    }

    // Track first landing
    const wheelsOnGround = telemetry.wheels.filter(w => w.isInContact).length;
    if (!hasLanded && chassisBody.position.y < 62) {
      console.log(`🎯 Vehicle landed on track`);
      hasLanded = true;
    }

    // Airborne detection with front/rear wheel tracking (throttled to once per second)
    const frontWheelsOnGround = telemetry.wheels.slice(0, 2).filter(w => w.isInContact).length;
    const rearWheelsOnGround = telemetry.wheels.slice(2, 4).filter(w => w.isInContact).length;
    const isAirborne = wheelsOnGround === 0;
    const isFrontUp = frontWheelsOnGround === 0 && rearWheelsOnGround > 0; // Wheelie

    if ((isAirborne || isFrontUp) && Date.now() - lastAirborneLog > 1000) {
      const carPos = new THREE.Vector3(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z);
      const projection = track.projectPoint(carPos);
      if (isFrontUp) {
        console.log(`🤸 WHEELIE at ${projection.sample.distance.toFixed(1)}m - Front wheels up! (F:${frontWheelsOnGround}/2, R:${rearWheelsOnGround}/2)`);
      } else {
        console.log(`🚁 AIRBORNE at ${projection.sample.distance.toFixed(1)}m (Y=${carPos.y.toFixed(1)}m, track Y=${projection.projected.y.toFixed(1)}m) (F:${frontWheelsOnGround}/2, R:${rearWheelsOnGround}/2)`);
      }
      lastAirborneLog = Date.now();
    }

    // Reduced logging - only every 3 seconds when moving
    frameCount++;
    if (frameCount % 180 === 0 && telemetry.speed > 0.5) {
      console.log(`📊 ${telemetry.speedKmh.toFixed(0)} km/h | ${telemetry.driftState} | Rear slip: ${telemetry.avgRearSlipAngle.toFixed(1)}°`);
    }

    // Log state changes (drift transitions)
    if (lastLogTime > 0) {
      const timeSinceLastLog = currentTime - lastLogTime;
      // Log immediately on state changes (with debounce)
      if (timeSinceLastLog > 500) {
        // Check for state changes
        const prevState = (window as any).__lastDriftState || 'GRIP';
        if (telemetry.driftState !== prevState) {
          console.log(`\n🔄 DRIFT STATE CHANGE: ${prevState} → ${telemetry.driftState}`);
          console.log(`   Rear slip: ${telemetry.avgRearSlipAngle.toFixed(2)}° | Speed: ${telemetry.speedKmh.toFixed(1)} km/h`);
          (window as any).__lastDriftState = telemetry.driftState;
          lastLogTime = currentTime;
        }
      }
    } else {
      (window as any).__lastDriftState = telemetry.driftState;
      lastLogTime = currentTime;
    }

    // Update HUD with telemetry
    if (debugCameraMode) {
      // DEBUG CAMERA MODE HUD
      hudDiv.innerHTML = `
        <strong style="color: #ff00ff;">📷 DEBUG CAMERA MODE</strong><br>
        <br>
        <strong>CONTROLS:</strong><br>
        <span style="color: #ffff00;">Click+Drag</span> - Look around<br>
        <span style="color: #ffff00;">WASD</span> - Move<br>
        <span style="color: #ffff00;">Q/E</span> - Down/Up<br>
        <span style="color: #ffff00;">Shift</span> - Sprint (fast movement)<br>
        <span style="color: #ffff00;">C</span> - Exit debug camera<br>
        <span style="color: #ffff00;">B</span> - Toggle collision boxes (${showCollisionBoxes ? 'ON' : 'OFF'})<br>
        <br>
        <strong>Position:</strong> (${freeCameraPosition.x.toFixed(1)}, ${freeCameraPosition.y.toFixed(1)}, ${freeCameraPosition.z.toFixed(1)})<br>
        <strong>Rotation:</strong> Yaw ${(freeCameraRotation.yaw * 180 / Math.PI).toFixed(0)}° Pitch ${(freeCameraRotation.pitch * 180 / Math.PI).toFixed(0)}°<br>
        <br>
        <strong style="color: #00ff00;">Green boxes:</strong> Track collision<br>
        <strong style="color: #ff0000;">Red boxes:</strong> Guardrails<br>
      `;
    } else if (showDetailedTelemetry) {
      hudDiv.innerHTML = formatTelemetryHUD(telemetry, false) + `
        <br>
        <strong>CONTROLS:</strong><br>
        W/↑ - Forward | S/↓ - Reverse<br>
        A/← - Left | D/→ - Right<br>
        Space - Handbrake (subtle, drift initiation)<br>
        T - Toggle telemetry | C - Debug camera | B - Collision boxes<br>
        <br>
        <strong>DRIFT TECHNIQUES:</strong><br>
        <em>Handbrake Drift:</em> Turn + Handbrake tap<br>
        <em>Swedish Flick:</em> Steer AWAY → snap INTO corner<br>
        <em>Power Over:</em> Accelerate hard in corner<br>
        <br>
        <strong>Config:</strong> ${vehicleConfig.name}
      `;
    } else {
      hudDiv.innerHTML = `
        <strong style="color: #00ffff;">🏔️ TOUGE RACER</strong><br>
        ${formatTelemetryHUD(telemetry, true)}
        <br>
        <strong>Controls:</strong> WASD/Arrows, Space=Brake, T=Telemetry, C=Debug Cam<br>
        <strong>Config:</strong> ${vehicleConfig.name}
      `;
    }

    // Render
    renderer.render(scene, camera);

    // Debug: Log render info once
    if (frameCount === 10) {
      console.log(`🎬 Rendering: camera at (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}), car at (${carMesh.position.x.toFixed(1)}, ${carMesh.position.y.toFixed(1)}, ${carMesh.position.z.toFixed(1)})`);
      console.log(`🎬 Scene has ${scene.children.length} children, camera looking at car: ${camera.matrix.elements[14].toFixed(1)}`);
    }
  }

  animate();

  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
