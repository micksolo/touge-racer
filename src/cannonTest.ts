import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createMountainTrack } from './track';
import { createTrackCollisionBodies, createTrackMaterial, createTrackWalls } from './trackCollision';

// ============================================================================
// CANNON-ES VEHICLE TEST - MOUNTAIN TRACK
// RaycastVehicle on touge track with segmented box collision
// ============================================================================

export function runCannonTest() {
  console.log('🧪 Starting cannon-es vehicle test on mountain track...');

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

  // Car visual (simple box)
  const carGeometry = new THREE.BoxGeometry(2, 1, 4);
  const carMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const carMesh = new THREE.Mesh(carGeometry, carMaterial);
  carMesh.castShadow = true;
  scene.add(carMesh);

  // Wheel visuals
  const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
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

  // Create track collision material
  const trackMaterial = createTrackMaterial({
    friction: 0.7,
    restitution: 0.0,
  });

  // Generate collision boxes along track
  const trackCollisionBodies = createTrackCollisionBodies(track, world, {
    segmentLength: 5,    // Box every 5 meters
    thickness: 0.5,      // 1m thick
    overlap: 0.1,        // 10cm overlap (boxes now oriented properly)
    material: trackMaterial,
  });

  // DEBUG: Visualize collision boxes
  const debugMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
  trackCollisionBodies.slice(0, 20).forEach((body) => { // Show first 20 boxes
    const shape = body.shapes[0] as CANNON.Box;
    const geometry = new THREE.BoxGeometry(
      shape.halfExtents.x * 2,
      shape.halfExtents.y * 2,
      shape.halfExtents.z * 2
    );
    const mesh = new THREE.Mesh(geometry, debugMaterial);
    mesh.position.copy(body.position as any);
    mesh.quaternion.copy(body.quaternion as any);
    scene.add(mesh);
  });

  // Optional: Add guardrails
  const wallBodies = createTrackWalls(track, world, {
    height: 2,
    offset: 13,  // Just beyond track edge
    segmentLength: 10,
  });

  // Step the world once to initialize collision detection
  world.step(1/60);

  // Car chassis body
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
  const chassisBody = new CANNON.Body({
    mass: 150,
    shape: chassisShape,
    angularDamping: 0.8,  // High damping to prevent flipping
    linearDamping: 0.05,  // Slight damping to reduce bouncing
    // Temporarily enable collision to prevent falling through
    // Once wheels make contact, they should support the car
  });

  // Lower center of mass to prevent wheelies and flipping
  chassisBody.centerOfMassOffset = new CANNON.Vec3(0, -0.5, 0);

  // Spawn car at track start, close to surface
  const startSample = track.samples[0];
  const startPos = startSample.position;
  const startTangent = startSample.tangent;

  chassisBody.position.set(startPos.x, startPos.y + 2, startPos.z);

  // Orient car along track tangent
  const startYaw = Math.atan2(startTangent.x, startTangent.z);
  chassisBody.quaternion.setFromEuler(0, startYaw, 0);

  world.addBody(chassisBody);

  console.log(`🚗 Chassis spawned at track start: (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`);
  console.log(`   Orientation: ${(startYaw * 180 / Math.PI).toFixed(1)}° yaw`);

  // Create RaycastVehicle
  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,   // X
    indexUpAxis: 1,      // Y
    indexForwardAxis: 2, // Z
  });

  // Add wheels
  const wheelOptions = {
    radius: 0.4,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 100,
    suspensionRestLength: 0.5,  // Normal suspension length
    frictionSlip: 5,
    dampingRelaxation: 5.0,   // Increased damping to reduce bouncing/rocking
    dampingCompression: 8.0,  // Increased damping to reduce bouncing/rocking
    maxSuspensionForce: 10000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
    maxSuspensionTravel: 0.5,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  // Wheel positions: [left/right, down, front/back]
  const wheelPositions = [
    new CANNON.Vec3(-1, -0.5, 1.2),  // Front-left
    new CANNON.Vec3(1, -0.5, 1.2),   // Front-right
    new CANNON.Vec3(-1, -0.5, -1.2), // Rear-left
    new CANNON.Vec3(1, -0.5, -1.2),  // Rear-right
  ];

  wheelPositions.forEach((position) => {
    vehicle.addWheel({
      ...wheelOptions,
      chassisConnectionPointLocal: position,
    });
  });

  vehicle.addToWorld(world);

  console.log('✅ Vehicle created with', vehicle.wheelInfos.length, 'wheels');
  console.log('   Coordinate axes: right=X(' + vehicle.indexRightAxis + '), up=Y(' + vehicle.indexUpAxis + '), forward=Z(' + vehicle.indexForwardAxis + ')');

  vehicle.wheelInfos.forEach((wheel, i) => {
    console.log(`   Wheel ${i}: connection=(${wheel.chassisConnectionPointLocal.x.toFixed(1)}, ${wheel.chassisConnectionPointLocal.y.toFixed(1)}, ${wheel.chassisConnectionPointLocal.z.toFixed(1)}), suspensionRest=${wheel.suspensionRestLength}, radius=${wheel.radius}`);
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
    switch (e.key) {
      case 'w':
      case 'ArrowUp':
        input.forward = true;
        break;
      case 's':
      case 'ArrowDown':
        input.backward = true;
        break;
      case 'a':
      case 'ArrowLeft':
        input.left = true;
        break;
      case 'd':
      case 'ArrowRight':
        input.right = true;
        break;
      case ' ':
        input.brake = true;
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key) {
      case 'w':
      case 'ArrowUp':
        input.forward = false;
        break;
      case 's':
      case 'ArrowDown':
        input.backward = false;
        break;
      case 'a':
      case 'ArrowLeft':
        input.left = false;
        break;
      case 'd':
      case 'ArrowRight':
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

  function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Apply vehicle controls
    const maxSteerVal = Math.PI / 8; // 22.5 degrees
    const maxForce = 150; // Reduced from 500 to prevent wheelies
    const brakeForce = 100; // Increased for better braking

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
      // Handbrake: 95% rear, 5% front to prevent forward flip
      vehicle.setBrake(brakeForce * 0.05, 0); // Front-left
      vehicle.setBrake(brakeForce * 0.05, 1); // Front-right
      vehicle.setBrake(brakeForce * 1.95, 2); // Rear-left (most)
      vehicle.setBrake(brakeForce * 1.95, 3); // Rear-right (most)
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

    // Track first landing
    const wheelsOnGround = vehicle.wheelInfos.filter(w => w.isInContact).length;
    if (!hasLanded && wheelsOnGround > 0) {
      console.log(`🎯 LANDED! ${wheelsOnGround}/4 wheels on ground at Y=${chassisBody.position.y.toFixed(2)}`);
      vehicle.wheelInfos.forEach((wheel, i) => {
        console.log(`   Wheel ${i}: contact=${wheel.isInContact}, suspensionLen=${wheel.suspensionLength.toFixed(2)}m`);
      });
      hasLanded = true;
    }

    // Update HUD
    const speed = chassisBody.velocity.length();
    const speedKmh = (speed * 3.6).toFixed(1);

    hudDiv.innerHTML = `
      <strong>🏔️ Mountain Track Test</strong><br>
      Speed: ${speedKmh} km/h<br>
      Position: (${chassisBody.position.x.toFixed(1)}, ${chassisBody.position.y.toFixed(1)}, ${chassisBody.position.z.toFixed(1)})<br>
      Wheels on ground: ${wheelsOnGround}/4<br>
      <br>
      <strong>Controls:</strong><br>
      W/↑ - Forward<br>
      S/↓ - Backward<br>
      A/← - Left<br>
      D/→ - Right<br>
      Space - Brake
    `;

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
