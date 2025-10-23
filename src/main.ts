import './style.css';
import * as THREE from 'three';
import { createMountainTrack } from './track';
import { InputController } from './input';
import { createCarState, stepCar } from './carPhysics';
import type { CarSpec, CarState, CarTelemetry } from './carPhysics';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app container not found');
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const hud = document.createElement('div');
hud.className = 'hud';
hud.innerHTML = `
  <div><strong>Speed</strong><span id="hud-speed">0 km/h</span></div>
  <div><strong>Slip</strong><span id="hud-drift">0°</span></div>
  <div><strong>Grade</strong><span id="hud-grade">0%</span></div>
  <div><strong>Score</strong><span id="hud-score">0</span></div>
`;
app.appendChild(hud);

const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed');
const hudDrift = document.querySelector<HTMLSpanElement>('#hud-drift');
const hudGrade = document.querySelector<HTMLSpanElement>('#hud-grade');
const hudScore = document.querySelector<HTMLSpanElement>('#hud-score');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1221);
scene.fog = new THREE.Fog(0x0a1221, 90, 700);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(60, 52, 75);

const track = createMountainTrack();
scene.add(track.mesh);

scene.add(createGround());
scene.add(createBackgroundMountains());

const ambient = new THREE.AmbientLight(0x6d7fb6, 0.42);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x8da7ff, 0x0d1220, 0.6);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2ce, 1.2);
sun.position.set(-140, 210, 130);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -420;
sun.shadow.camera.right = 420;
sun.shadow.camera.top = 420;
sun.shadow.camera.bottom = -420;
sun.shadow.camera.near = 30;
sun.shadow.camera.far = 700;
scene.add(sun);

const carSpec: CarSpec = { driftControl: 4, power: 2 };
const carState = createCarState(track, carSpec);
const carVisual = createCarVisual();
carVisual.group.position.copy(carState.position);
scene.add(carVisual.group);

const input = new InputController();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const cameraPosition = new THREE.Vector3().copy(camera.position);
const cameraUp = new THREE.Vector3(0, 1, 0);
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const telemetry = stepCar(carState, input.getSnapshot(), track, dt);
  updateCarVisual(carVisual, carState, dt);
  updateCamera(camera, carState, telemetry, dt);
  updateHud(telemetry);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

window.addEventListener('beforeunload', () => {
  input.dispose();
});

function updateHud(telemetry: CarTelemetry) {
  if (hudSpeed) {
    hudSpeed.textContent = `${Math.round(telemetry.speed * 3.6)} km/h`;
  }
  if (hudDrift) {
    hudDrift.textContent = `${telemetry.slipAngleDeg.toFixed(0)}°`;
  }
  if (hudGrade) {
    hudGrade.textContent = `${telemetry.gradePercent.toFixed(1)}%`;
  }
  if (hudScore) {
    hudScore.textContent = telemetry.score.toFixed(1);
  }
  hud.classList.toggle('hud-drifting', telemetry.driftActive);
}

function updateCarVisual(visual: CarVisual, state: CarState, dt: number) {
  if (!state.lastProjection) {
    return;
  }
  const up = state.lastProjection.sample.normal.clone().normalize();
  const forward = tmpForward.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
  forward.projectOnPlane(up);
  if (forward.lengthSq() === 0) {
    forward.copy(state.lastProjection.sample.tangent).normalize();
  } else {
    forward.normalize();
  }
  const right = tmpRight.copy(up).cross(forward).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, forward);
  visual.group.setRotationFromMatrix(basis);
  visual.group.position.copy(state.position);

  const wheelRadius = visual.wheelRadius;
  const longitudinalVelocity = state.velocity.x * forward.x + state.velocity.y * forward.z;
  const angularVelocity = wheelRadius > 0 ? longitudinalVelocity / wheelRadius : 0;
  visual.wheelSpin = (visual.wheelSpin + angularVelocity * dt) % (Math.PI * 2);
  visual.allWheels.forEach((wheel) => {
    wheel.rotation.x = visual.wheelSpin;
  });

  const steerAngle = THREE.MathUtils.clamp(state.steerAngle, -0.75, 0.75);
  visual.frontPivots.forEach((pivot) => {
    pivot.rotation.y = steerAngle;
  });
}

function updateCamera(cameraRef: THREE.PerspectiveCamera, state: CarState, telemetry: CarTelemetry, dt: number) {
  if (!state.lastProjection) {
    return;
  }
  const up = state.lastProjection.sample.normal;
  const forward = tmpForward.set(Math.cos(state.yaw), 0, Math.sin(state.yaw));
  forward.projectOnPlane(up);
  if (forward.lengthSq() === 0) {
    forward.copy(state.lastProjection.sample.tangent).normalize();
  } else {
    forward.normalize();
  }

  const followDistance = 12 + THREE.MathUtils.clamp(telemetry.speed * 0.12, 0, 15);
  const followHeight = 4.2;

  const desiredPosition = cameraPosition
    .copy(state.position)
    .addScaledVector(up, followHeight)
    .addScaledVector(forward, -followDistance);

  cameraRef.position.lerp(desiredPosition, 1 - Math.exp(-dt * 4.5));
  tmpTarget.copy(state.position).addScaledVector(up, 1.6);
  cameraTarget.lerp(tmpTarget, 1 - Math.exp(-dt * 7));
  cameraRef.lookAt(cameraTarget);
  cameraUp.copy(up).normalize();
  cameraRef.up.copy(cameraUp);
}

type CarVisual = {
  group: THREE.Group;
  allWheels: THREE.Mesh[];
  frontPivots: THREE.Object3D[];
  wheelRadius: number;
  wheelSpin: number;
};

function createCarVisual(): CarVisual {
  const group = new THREE.Group();

  const chassisGeometry = new THREE.BoxGeometry(3.4, 1.1, 6.1);
  const chassisMaterial = new THREE.MeshStandardMaterial({
    color: 0x44d1ff,
    metalness: 0.6,
    roughness: 0.4,
  });
  const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
  chassis.castShadow = true;
  group.add(chassis);

  const cabinGeometry = new THREE.BoxGeometry(2.2, 1, 2.7);
  const cabinMaterial = new THREE.MeshStandardMaterial({
    color: 0x111a2f,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.82,
  });
  const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
  cabin.position.set(0, 0.86, -0.2);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelRadius = 0.55;
  const wheelThickness = 0.5;
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 18, 1);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.6 });

  const pivotOffsets = [
    new THREE.Vector3(-1.45, -0.45, 1.9),
    new THREE.Vector3(1.45, -0.45, 1.9),
    new THREE.Vector3(-1.45, -0.45, -1.9),
    new THREE.Vector3(1.45, -0.45, -1.9),
  ];

  const allWheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Object3D[] = [];

  pivotOffsets.forEach((offset, index) => {
    const pivot = new THREE.Object3D();
    pivot.position.copy(offset);
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.castShadow = true;
    wheel.position.set(0, 0, 0);
    pivot.add(wheel);
    group.add(pivot);
    allWheels.push(wheel);
    if (index < 2) {
      frontPivots.push(pivot);
    }
  });

  const underglowGeometry = new THREE.PlaneGeometry(2.5, 5);
  const underglowMaterial = new THREE.MeshBasicMaterial({
    color: 0x2ec5ff,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
  });
  const underglow = new THREE.Mesh(underglowGeometry, underglowMaterial);
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = -0.52;
  group.add(underglow);

  return {
    group,
    allWheels,
    frontPivots,
    wheelRadius,
    wheelSpin: 0,
  };
}

function createGround(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(1200, 72);
  const material = new THREE.MeshStandardMaterial({
    color: 0x141c2e,
    roughness: 0.9,
    metalness: 0.04,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  ground.receiveShadow = true;
  return ground;
}

function createBackgroundMountains(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x23314d,
    roughness: 0.94,
    metalness: 0.05,
  });
  const geometry = new THREE.ConeGeometry(120, 160, 6);
  geometry.translate(0, 80, 0);

  const positions = [
    new THREE.Vector3(-260, -6, -80),
    new THREE.Vector3(240, -6, -160),
    new THREE.Vector3(160, -6, -360),
    new THREE.Vector3(-200, -6, -420),
  ];

  positions.forEach((pos, idx) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.7 + idx * 0.25);
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  return group;
}
