import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createMountainTrack } from './track';
import { createTrackCollisionBodies, createTrackMaterial, createTrackWalls } from './trackCollision';
import { calculateVehicleTelemetry, formatTelemetryHUD, type VehicleTelemetry } from './telemetry';
import { getVehicleConfig, describeVehicle, type VehicleConfigKey } from './vehicleConfig';

// ============================================================================
// CANNON-ES VEHICLE TEST - MOUNTAIN TRACK
// RaycastVehicle on touge track with segmented box collision
// ============================================================================

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

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
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

  // FUTURE-PROOF COLLISION: Very dense, small boxes that can handle elevation changes
  // This approach works for both flat and mountain roads
  const trackBodies: CANNON.Body[] = [];
  const boxSpacing = 0.5; // Box every 0.5 meters - very dense
  const boxWidth = track.width + 4; // Extra wide (16m vs 12m visual) to cover corners
  const boxLength = 2.0; // 2m long boxes with overlap
  const boxThickness = 1.0; // 2m thick (1m half-height)

  let distanceCounter = 0;
  for (let i = 0; i < track.samples.length; i++) {
    const sample = track.samples[i];

    if (sample.distance >= distanceCounter) {
      // Create axis-aligned box at this position
      const shape = new CANNON.Box(new CANNON.Vec3(
        boxWidth * 0.5,
        boxThickness,
        boxLength * 0.5
      ));
      shape.material = trackMaterial;

      const body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
      });
      body.addShape(shape);

      // Position box with top surface at track level
      body.position.set(
        sample.position.x,
        sample.position.y - boxThickness, // Top at track surface
        sample.position.z
      );

      world.addBody(body);
      trackBodies.push(body);

      distanceCounter += boxSpacing;
    }
  }

  console.log(`✅ Track collision: ${trackBodies.length} dense boxes (every ${boxSpacing}m, will support elevation changes)`);

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
  });

  // Center of mass from config
  chassisBody.centerOfMassOffset = vehicleConfig.chassis.centerOfMassOffset;

  // Spawn car at track start, moved forward to ensure it's on a collision box
  const startSample = track.samples[10]; // Use sample 10 instead of 0 to ensure on collision box
  const startPos = startSample.position;
  const startTangent = startSample.tangent;

  // Spawn chassis higher above the ground and let it drop
  // This prevents clipping into collision boxes at spawn
  const wheelConnectionY = Math.abs(vehicleConfig.wheels.positions[0].y);
  const spawnHeight = vehicleConfig.wheels.radius + vehicleConfig.suspension.restLength + wheelConnectionY + 5.0; // Very large buffer - car will drop
  chassisBody.position.set(startPos.x, startPos.y + spawnHeight, startPos.z);

  // Orient car along track tangent
  const startYaw = Math.atan2(startTangent.x, startTangent.z);
  chassisBody.quaternion.setFromEuler(0, startYaw, 0);

  world.addBody(chassisBody);

  console.log(`🚗 Chassis spawned at Y=${(startPos.y + spawnHeight).toFixed(1)} (drops to track at Y=${startPos.y.toFixed(1)})`);

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

  console.log(`✅ Vehicle ready: ${vehicleConfig.name} (${vehicleConfig.chassis.mass}kg, ${vehicle.wheelInfos.length} wheels)`);

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
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        input.forward = true;
        break;
      case 's':
      case 'arrowdown':
        input.backward = true;
        break;
      case 'a':
      case 'arrowleft':
        input.left = true;
        break;
      case 'd':
      case 'arrowright':
        input.right = true;
        break;
      case ' ':
        input.brake = true;
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

    // Update physics
    vehicle.updateVehicle(1 / 60);
    world.step(1 / 60, deltaTime, 3);

    // Update visuals from physics
    carMesh.position.copy(chassisBody.position as any);
    carMesh.quaternion.copy(chassisBody.quaternion as any);

    // Update wheel visuals
    vehicle.wheelInfos.forEach((wheel, i) => {
      vehicle.updateWheelTransform(i);
      const transform = wheel.worldTransform;
      wheelMeshes[i].position.copy(transform.position as any);
      wheelMeshes[i].quaternion.copy(transform.quaternion as any);
    });

    // Camera follows car from behind in local space
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

    // Calculate telemetry
    const telemetry = calculateVehicleTelemetry(vehicle, chassisBody);

    // Track first landing
    const wheelsOnGround = telemetry.wheels.filter(w => w.isInContact).length;
    if (!hasLanded && chassisBody.position.y < 62) {
      console.log(`🎯 Vehicle landed on track`);
      hasLanded = true;
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
    if (showDetailedTelemetry) {
      hudDiv.innerHTML = formatTelemetryHUD(telemetry, false) + `
        <br>
        <strong>CONTROLS:</strong><br>
        W/↑ - Forward | S/↓ - Reverse<br>
        A/← - Left | D/→ - Right<br>
        Space - Handbrake (subtle, drift initiation)<br>
        T - Toggle telemetry<br>
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
        <strong>Controls:</strong> WASD/Arrows, Space=Brake, T=Telemetry<br>
        <strong>Config:</strong> ${vehicleConfig.name}
      `;
    }

    // Render
    renderer.render(scene, camera);
  }

  animate();

  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
