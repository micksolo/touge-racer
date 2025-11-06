import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ============================================================================
// MINIMAL CANNON-ES VEHICLE TEST
// Simple scene: flat ground + car with RaycastVehicle
// ============================================================================

export function runCannonTest() {
  console.log('🧪 Starting minimal cannon-es vehicle test...');

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

  // Ground visual (large plane with grid)
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Add grid helper to see movement
  const gridHelper = new THREE.GridHelper(200, 40, 0x888888, 0x444444);
  gridHelper.position.y = 0.01; // Slightly above ground to prevent z-fighting
  scene.add(gridHelper);

  // Add some reference cubes
  const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
  const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  for (let i = 0; i < 5; i++) {
    const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
    cube.position.set(
      (Math.random() - 0.5) * 40,
      1,
      (Math.random() - 0.5) * 40
    );
    cube.castShadow = true;
    scene.add(cube);
  }

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

  // Test sphere visual (will be updated later when we have the physics body reference)
  const testSphereGeometry = new THREE.SphereGeometry(0.5, 16, 16);
  const testSphereMaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
  const testSphereMesh = new THREE.Mesh(testSphereGeometry, testSphereMaterial);
  testSphereMesh.castShadow = true;
  scene.add(testSphereMesh);

  // ============================================================================
  // CANNON-ES PHYSICS SETUP
  // ============================================================================

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.81, 0),
  });

  // Ground body - simple large box (guaranteed to work for body collision)
  const groundShape = new CANNON.Box(new CANNON.Vec3(100, 1, 100)); // 200x2x200 meters
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: groundShape,
    type: CANNON.Body.STATIC,
  });

  groundBody.position.set(0, -1, 0); // Top surface at Y=0

  world.addBody(groundBody);

  console.log('✅ Ground box created (200m x 2m x 200m, top at Y=0)');

  // TEST: Add a bouncing sphere to verify body-body collision works
  const testSphereShape = new CANNON.Sphere(0.5);
  const testSphereBody = new CANNON.Body({
    mass: 10,
    shape: testSphereShape,
    position: new CANNON.Vec3(5, 10, 0), // Spawn to the side
  });
  world.addBody(testSphereBody);
  console.log('🔵 Test sphere added at (5, 10, 0) - should bounce if collision works');

  // Step the world once to initialize collision detection
  world.step(1/60);

  // TEST: Manual raycast to verify ground detection
  const testFrom = new CANNON.Vec3(0, 5, 0);
  const testTo = new CANNON.Vec3(0, -5, 0);
  const testResult = new CANNON.RaycastResult();

  world.raycastClosest(testFrom, testTo, {
    skipBackfaces: false,
    checkCollisionResponse: false,
  }, testResult);

  if (testResult.hasHit) {
    console.log(`✅ Manual raycast HIT ground at Y=${testResult.hitPointWorld.y.toFixed(2)}`);
    console.log(`   Normal: (${testResult.hitNormalWorld.x.toFixed(2)}, ${testResult.hitNormalWorld.y.toFixed(2)}, ${testResult.hitNormalWorld.z.toFixed(2)})`);
    console.log(`   Distance: ${testResult.distance.toFixed(2)}m`);
  } else {
    console.log(`❌ Manual raycast MISSED`);
    console.log(`   From: (${testFrom.x}, ${testFrom.y}, ${testFrom.z})`);
    console.log(`   To: (${testTo.x}, ${testTo.y}, ${testTo.z})`);
    console.log(`   Bodies in world: ${world.bodies.length}`);
  }

  // Car chassis body
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
  chassisShape.collisionResponse = false; // Don't collide - let wheels handle ground contact
  const chassisBody = new CANNON.Body({
    mass: 150,
    shape: chassisShape,
  });

  // Lower center of mass to prevent wheelies
  chassisBody.centerOfMassOffset = new CANNON.Vec3(0, -0.3, 0);

  // Spawn car well above ground and let it fall
  // This ensures wheels aren't initially clipping through the plane
  chassisBody.position.set(0, 5, 0);
  world.addBody(chassisBody);

  console.log('🚗 Chassis spawned at Y=5');
  console.log('   Ground plane at Y=0');

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
    suspensionRestLength: 0.7,
    frictionSlip: 5,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
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
      // More brake on rear to prevent nose dive
      vehicle.setBrake(brakeForce * 0.6, 0); // Front-left
      vehicle.setBrake(brakeForce * 0.6, 1); // Front-right
      vehicle.setBrake(brakeForce * 1.4, 2); // Rear-left (more)
      vehicle.setBrake(brakeForce * 1.4, 3); // Rear-right (more)
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

    // Update test sphere visual
    testSphereMesh.position.copy(testSphereBody.position as any);

    // Update wheel visuals
    vehicle.wheelInfos.forEach((wheel, i) => {
      vehicle.updateWheelTransform(i);
      const transform = wheel.worldTransform;
      wheelMeshes[i].position.copy(transform.position as any);
      wheelMeshes[i].quaternion.copy(transform.quaternion as any);
    });

    // Camera follows car from behind
    // Since car forward is +Z, camera should be at -Z (behind)
    const cameraOffset = new THREE.Vector3(0, 5, -15);
    const cameraPosition = new THREE.Vector3()
      .copy(carMesh.position)
      .add(cameraOffset);
    camera.position.lerp(cameraPosition, 0.1);
    camera.lookAt(carMesh.position);

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
      <strong>🚗 Cannon-ES Vehicle Test</strong><br>
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
