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

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Ground visual (large plane)
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
  });
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

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

  // Ground body (infinite plane at Y=0)
  const groundShape = new CANNON.Plane();
  const groundBody = new CANNON.Body({
    mass: 0,
    shape: groundShape,
    type: CANNON.Body.STATIC,
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Horizontal
  world.addBody(groundBody);

  // Car chassis body
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
  const chassisBody = new CANNON.Body({
    mass: 150,
    shape: chassisShape,
  });
  chassisBody.position.set(0, 4, 0); // Start 4m above ground
  world.addBody(chassisBody);

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
    suspensionStiffness: 30,
    suspensionRestLength: 0.3,
    frictionSlip: 5,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 10000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
    maxSuspensionTravel: 0.3,
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

  function animate() {
    requestAnimationFrame(animate);

    const currentTime = performance.now();
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    // Apply vehicle controls
    const maxSteerVal = Math.PI / 8; // 22.5 degrees
    const maxForce = 500;
    const brakeForce = 10;

    let steerValue = 0;
    if (input.left) steerValue += maxSteerVal;
    if (input.right) steerValue -= maxSteerVal;

    vehicle.setSteeringValue(steerValue, 0); // Front-left
    vehicle.setSteeringValue(steerValue, 1); // Front-right

    let engineForce = 0;
    if (input.forward) engineForce = maxForce;
    if (input.backward) engineForce = -maxForce;

    vehicle.applyEngineForce(engineForce, 2); // Rear-left
    vehicle.applyEngineForce(engineForce, 3); // Rear-right

    if (input.brake) {
      vehicle.setBrake(brakeForce, 0);
      vehicle.setBrake(brakeForce, 1);
      vehicle.setBrake(brakeForce, 2);
      vehicle.setBrake(brakeForce, 3);
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

    // Camera follows car
    const cameraOffset = new THREE.Vector3(0, 5, 15);
    const cameraPosition = new THREE.Vector3()
      .copy(carMesh.position)
      .add(cameraOffset);
    camera.position.lerp(cameraPosition, 0.1);
    camera.lookAt(carMesh.position);

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
