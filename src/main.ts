import './style.css';
import * as THREE from 'three';
import { createMountainTrack } from './track';
import type { TrackSurface } from './track';
import { InputController } from './input';
import type { InputSnapshot } from './input';
import { createCarState, stepCar } from './carPhysics';
import type { CarSpec, CarState, CarTelemetry, CarConfig } from './carPhysics';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app container not found');
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.85;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const hud = document.createElement('div');
hud.className = 'hud';
hud.innerHTML = `
  <div><strong>Speed</strong><span id="hud-speed">0 km/h</span></div>
  <div><strong>Slip</strong><span id="hud-drift">0°</span></div>
  <div><strong>State</strong><span id="hud-state">GRIP</span></div>
  <div><strong>Grade</strong><span id="hud-grade">0%</span></div>
  <div><strong>Score</strong><span id="hud-score">0</span></div>
`;
app.appendChild(hud);

const hudSpeed = document.querySelector<HTMLSpanElement>('#hud-speed');
const hudDrift = document.querySelector<HTMLSpanElement>('#hud-drift');
const hudState = document.querySelector<HTMLSpanElement>('#hud-state');
const hudGrade = document.querySelector<HTMLSpanElement>('#hud-grade');
const hudScore = document.querySelector<HTMLSpanElement>('#hud-score');

const debugPanel = document.createElement('div');
debugPanel.className = 'debug-panel';
app.appendChild(debugPanel);

type DebugField = {
  key: keyof DebugData;
  label: string;
  min: number;
  max: number;
  formatter?: (value: number) => string;
};

const formatNumber = (value: number): string => value.toFixed(2);

type DebugData = {
  steerInput: number;
  throttle: number;
  brake: number;
  handbrake: number;
  steerAngleDeg: number;
  yawRateDeg: number;
  slipAngleDeg: number;
  frontSlipDeg: number;
  rearSlipDeg: number;
  lateralSpeed: number;
  longitudinalSpeed: number;
  driftStateName: string;
  assistStrength: number;
};

const debugFields: DebugField[] = [
  { key: 'steerInput', label: 'Steer', min: -1, max: 1, formatter: formatNumber },
  { key: 'throttle', label: 'Throttle', min: 0, max: 1, formatter: formatNumber },
  { key: 'brake', label: 'Brake', min: 0, max: 1, formatter: formatNumber },
  { key: 'handbrake', label: 'Handbrake', min: 0, max: 1, formatter: formatNumber },
  { key: 'steerAngleDeg', label: 'Steer°', min: -45, max: 45, formatter: (v) => `${v.toFixed(1)}` },
  { key: 'yawRateDeg', label: 'Yaw°/s', min: -180, max: 180, formatter: (v) => `${v.toFixed(1)}` },
  { key: 'slipAngleDeg', label: 'Slip°', min: -60, max: 60, formatter: (v) => `${v.toFixed(1)}` },
  { key: 'frontSlipDeg', label: 'Front°', min: -60, max: 60, formatter: (v) => `${v.toFixed(1)}` },
  { key: 'rearSlipDeg', label: 'Rear°', min: -60, max: 60, formatter: (v) => `${v.toFixed(1)}` },
  { key: 'lateralSpeed', label: 'Lat m/s', min: -20, max: 20, formatter: (v) => `${v.toFixed(2)}` },
  { key: 'longitudinalSpeed', label: 'Long m/s', min: -60, max: 60, formatter: (v) => `${v.toFixed(2)}` },
  { key: 'assistStrength', label: 'Assist', min: 0, max: 1, formatter: (v) => `${(v * 100).toFixed(0)}%` },
];

const debugValues = new Map<keyof DebugData, HTMLSpanElement>();
const debugBars = new Map<keyof DebugData, HTMLDivElement>();

debugFields.forEach((field) => {
  const row = document.createElement('div');
  row.className = 'debug-row';

  const label = document.createElement('span');
  label.className = 'debug-label';
  label.textContent = field.label;
  row.appendChild(label);

  const value = document.createElement('span');
  value.className = 'debug-value';
  value.textContent = '0';
  row.appendChild(value);
  debugValues.set(field.key, value);

  const bar = document.createElement('div');
  bar.className = 'debug-bar';
  row.appendChild(bar);
  debugBars.set(field.key, bar);

  debugPanel.appendChild(row);
});

// Load saved values from localStorage or use defaults
const getSavedValue = (key: string, defaultValue: number): number => {
  const saved = localStorage.getItem(`feel_${key}`);
  return saved !== null ? Number(saved) : defaultValue;
};

const saveValue = (key: string, value: number) => {
  localStorage.setItem(`feel_${key}`, String(value));
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2740);
scene.fog = new THREE.Fog(0x1a2740, 140, 820);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(60, 52, 75);

const track = createMountainTrack();
scene.add(track.mesh);
scene.add(createTrackGlow(track));

scene.add(createGround());
// Removed background mountains - they looked like weird pyramids

const ambient = new THREE.AmbientLight(0xa5bbff, 0.55);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0xb5cbff, 0x17202f, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2ce, 1.45);
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

const rimLight = new THREE.DirectionalLight(0x4cc6ff, 0.6);
rimLight.position.set(260, 120, -240);
scene.add(rimLight);

const carSpec: CarSpec = { driftControl: 4, power: 2 };
const carState = createCarState(track, carSpec);
const carVisual = createCarVisual();
carVisual.group.position.copy(carState.position);
scene.add(carVisual.group);

// Simple Feel Tuning Panel (must be after carState creation)
const feelPanel = document.createElement('div');
feelPanel.className = 'feel-panel';
app.appendChild(feelPanel);

const feelTitleContainer = document.createElement('div');
feelTitleContainer.style.display = 'flex';
feelTitleContainer.style.justifyContent = 'space-between';
feelTitleContainer.style.alignItems = 'center';
feelTitleContainer.style.marginBottom = '18px';

const feelTitle = document.createElement('div');
feelTitle.className = 'feel-panel-title';
feelTitle.textContent = 'Car Feel Tuning';
feelTitle.style.marginBottom = '0';
feelTitleContainer.appendChild(feelTitle);

const resetButton = document.createElement('button');
resetButton.textContent = 'Reset';
resetButton.className = 'feel-reset-button';
feelTitleContainer.appendChild(resetButton);

feelPanel.appendChild(feelTitleContainer);

type FeelControl = {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
};

const feelControls: FeelControl[] = [
  {
    key: 'overallGrip',
    label: 'Overall Grip',
    description: 'How sticky the tires are (higher = more grip, less sliding)',
    min: 0.2,
    max: 3.5,
    defaultValue: 1.0,
    step: 0.05,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onChange: (value) => {
      const baseFront = 22000;
      const baseRear = 18000;
      const balanceMultiplier = (carState.config as any).frontRearBalance ?? 1.5;
      carState.config.corneringStiffnessFront = baseFront * value * balanceMultiplier;
      carState.config.corneringStiffnessRear = baseRear * value;
      saveValue('overallGrip', value);
      console.log(`[Feel] Overall Grip: ${(value * 100).toFixed(0)}%, Front: ${(baseFront * value * balanceMultiplier).toFixed(0)}, Rear: ${(baseRear * value).toFixed(0)}, Ratio: ${balanceMultiplier.toFixed(2)}:1`);
    }
  },
  {
    key: 'frontRearBalance',
    label: 'Front/Rear Grip Balance',
    description: 'Front grip vs rear (higher = more front grip, easier to drift)',
    min: 0.5,
    max: 4.0,
    defaultValue: 1.5,
    step: 0.1,
    format: (v) => `${v.toFixed(1)}:1`,
    onChange: (value) => {
      (carState.config as any).frontRearBalance = value;
      const overallGrip = getSavedValue('overallGrip', 1.0);
      const baseFront = 22000;
      const baseRear = 18000;
      carState.config.corneringStiffnessFront = baseFront * overallGrip * value;
      carState.config.corneringStiffnessRear = baseRear * overallGrip;
      saveValue('frontRearBalance', value);
      console.log(`[Feel] Front/Rear Balance: ${value.toFixed(1)}:1, Front: ${(baseFront * overallGrip * value).toFixed(0)}, Rear: ${(baseRear * overallGrip).toFixed(0)}`);
    }
  },
  {
    key: 'driftSensitivity',
    label: 'Drift Sensitivity',
    description: 'How easily drifts start (higher = harder to drift, more grip driving)',
    min: 5,
    max: 45,
    defaultValue: 22,
    step: 1,
    format: (v) => `${v.toFixed(0)}°`,
    onChange: (value) => {
      carState.config.driftThresholdSlip = value;
      saveValue('driftSensitivity', value);
      console.log(`[Feel] Drift Sensitivity: ${value.toFixed(0)}°`);
    }
  },
  {
    key: 'straighteningForce',
    label: 'Straightening Force',
    description: 'How quickly car stops rotating and straightens out',
    min: 0.5,
    max: 50,
    defaultValue: 12,
    step: 0.5,
    format: (v) => `${v.toFixed(1)}`,
    onChange: (value) => {
      carState.config.yawDragCoeff = value;
      saveValue('straighteningForce', value);
      console.log(`[Feel] Straightening Force: ${value.toFixed(1)}`);
    }
  },
  {
    key: 'counterSteerStrength',
    label: 'Counter-Steer Strength',
    description: 'How much counter-steering helps (lower = gentler, higher = more aggressive)',
    min: 0,
    max: 2.0,
    defaultValue: 0.25,
    step: 0.05,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onChange: (value) => {
      carState.config.counterSteerBoost = value;
      saveValue('counterSteerStrength', value);
      console.log(`[Feel] Counter-Steer Strength: ${(value * 100).toFixed(0)}%`);
    }
  },
  {
    key: 'steeringSpeed',
    label: 'Steering Response Speed',
    description: 'How fast steering reacts to keyboard taps (lower = smoother, higher = snappier)',
    min: 0.5,
    max: 30,
    defaultValue: 8.0,
    step: 0.5,
    format: (v) => `${v.toFixed(1)}`,
    onChange: (value) => {
      carState.config.steeringAttackRate = value;
      saveValue('steeringSpeed', value);
      console.log(`[Feel] Steering Response Speed: ${value.toFixed(1)}`);
    }
  },
  {
    key: 'steeringStrength',
    label: 'Steering Strength',
    description: 'How much the car turns when you tap (lower = gentler turns, higher = sharper)',
    min: 0.3,
    max: 2.0,
    defaultValue: 1.0,
    step: 0.05,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onChange: (value) => {
      (carState.config as any).steeringStrengthMultiplier = value;
      saveValue('steeringStrength', value);
      console.log(`[Feel] Steering Strength: ${(value * 100).toFixed(0)}%`);
    }
  },
  {
    key: 'weightShiftFeel',
    label: 'Weight Shift Feel',
    description: 'How much car nose-dives when braking (higher = more dramatic)',
    min: 0.3,
    max: 0.8,
    defaultValue: 0.52,
    step: 0.02,
    format: (v) => `${v.toFixed(2)}`,
    onChange: (value) => {
      carState.config.heightCG = value;
      saveValue('weightShiftFeel', value);
      console.log(`[Feel] Weight Shift Feel: ${value.toFixed(2)}`);
    }
  }
];

// Store slider references for reset functionality
const sliderMap = new Map<string, { slider: HTMLInputElement; display: HTMLSpanElement; control: FeelControl }>();

feelControls.forEach((control) => {
  const row = document.createElement('div');
  row.className = 'feel-row';

  const labelContainer = document.createElement('label');
  labelContainer.className = 'feel-label';

  const labelText = document.createElement('span');
  labelText.textContent = control.label;
  labelContainer.appendChild(labelText);

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'feel-value';
  labelContainer.appendChild(valueDisplay);

  row.appendChild(labelContainer);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(control.min);
  slider.max = String(control.max);
  slider.step = String(control.step);

  // Load saved value or use default
  const initialValue = getSavedValue(control.key, control.defaultValue);
  slider.value = String(initialValue);
  valueDisplay.textContent = control.format(initialValue);

  // Initialize config with saved value
  control.onChange(initialValue);

  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    control.onChange(value);
    valueDisplay.textContent = control.format(value);
  });
  // Prevent arrow keys from affecting sliders (interferes with driving)
  slider.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  // Prevent sliders from stealing focus
  slider.addEventListener('mousedown', () => {
    setTimeout(() => slider.blur(), 0);
  });
  row.appendChild(slider);

  const description = document.createElement('div');
  description.className = 'feel-description';
  description.textContent = control.description;
  row.appendChild(description);

  feelPanel.appendChild(row);

  sliderMap.set(control.key, { slider, display: valueDisplay, control });
});

// Reset button functionality
resetButton.addEventListener('click', () => {
  console.log('[Feel] Resetting to defaults...');
  sliderMap.forEach(({ slider, display, control }) => {
    slider.value = String(control.defaultValue);
    display.textContent = control.format(control.defaultValue);
    control.onChange(control.defaultValue);
    localStorage.removeItem(`feel_${control.key}`);
  });
  console.log('[Feel] Reset complete!');
});

const input = new InputController();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const cameraPosition = new THREE.Vector3().copy(camera.position);
const cameraUp = new THREE.Vector3(0, 1, 0);
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
let debugEnabled = false;
let telemetryLogTimer = 0;
let diagnosticMode = false;

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyP') {
    debugEnabled = !debugEnabled;
    debugPanel.classList.toggle('visible', debugEnabled);
  }
  if (event.code === 'KeyD') {
    diagnosticMode = !diagnosticMode;
    if (diagnosticMode) {
      console.log('🔬 DIAGNOSTIC MODE ENABLED - Watch console for detailed physics breakdown');
      console.log('Press D again to disable');
    } else {
      console.log('🔬 DIAGNOSTIC MODE DISABLED');
    }
  }
});

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const snapshot = input.getSnapshot();
  const telemetry = stepCar(carState, snapshot, track, dt, diagnosticMode);
  updateCarVisual(carVisual, carState, dt);
  updateCamera(camera, carState, telemetry, dt);
  updateHud(telemetry);
  updateDebug(snapshot, telemetry);
  logTelemetry(snapshot, telemetry, dt);
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
  if (hudState) {
    hudState.textContent = telemetry.driftStateName;
  }
  if (hudGrade) {
    hudGrade.textContent = `${telemetry.gradePercent.toFixed(1)}%`;
  }
  if (hudScore) {
    hudScore.textContent = telemetry.score.toFixed(1);
  }
  hud.classList.toggle('hud-drifting', telemetry.driftActive);
}

function updateDebug(snapshot: InputSnapshot, telemetry: CarTelemetry) {
  if (!debugEnabled) {
    return;
  }

  const data: DebugData = {
    steerInput: snapshot.steer,
    throttle: snapshot.throttle,
    brake: snapshot.brake,
    handbrake: snapshot.handbrake,
    steerAngleDeg: telemetry.steerAngleDeg,
    yawRateDeg: telemetry.yawRateDeg,
    slipAngleDeg: telemetry.slipAngleDeg,
    frontSlipDeg: telemetry.frontSlipDeg,
    rearSlipDeg: telemetry.rearSlipDeg,
    lateralSpeed: telemetry.lateralSpeed,
    longitudinalSpeed: telemetry.longitudinalSpeed,
    driftStateName: telemetry.driftStateName,
    assistStrength: telemetry.assistStrength,
  };

  debugFields.forEach((field) => {
    const value = data[field.key] as number;  // All debugFields are numeric
    const formatted = field.formatter ? field.formatter(value) : value.toFixed(2);
    const valueElement = debugValues.get(field.key);
    if (valueElement) {
      valueElement.textContent = formatted;
    }
    const bar = debugBars.get(field.key);
    if (bar) {
      const normalized =
        (THREE.MathUtils.clamp(value, field.min, field.max) - field.min) / (field.max - field.min);
      const widthPercent = `${(normalized * 100).toFixed(1)}%`;
      bar.style.setProperty('--fill', widthPercent);
    }
  });
}

function logTelemetry(snapshot: InputSnapshot, telemetry: CarTelemetry, dt: number) {
  if (!debugEnabled) {
    telemetryLogTimer = 0;
    return;
  }

  telemetryLogTimer += dt;
  const slipSpike =
    Math.abs(telemetry.frontSlipDeg) > 28 ||
    Math.abs(telemetry.rearSlipDeg) > 32 ||
    Math.abs(telemetry.slipAngleDeg) > 25;

  if (slipSpike || telemetryLogTimer >= 0.6) {
    const normalizedProgress = telemetry.progress / track.totalLength;
    const payload = {
      progressMeters: telemetry.progress.toFixed(1),
      progressPercent: (normalizedProgress * 100).toFixed(2),
      steerInput: snapshot.steer.toFixed(2),
      steerAngleDeg: telemetry.steerAngleDeg.toFixed(1),
      yawRateDeg: telemetry.yawRateDeg.toFixed(1),
      speedKmh: (telemetry.speed * 3.6).toFixed(1),
      longSpeed: telemetry.longitudinalSpeed.toFixed(2),
      latSpeed: telemetry.lateralSpeed.toFixed(2),
      slipDeg: telemetry.slipAngleDeg.toFixed(1),
      frontSlipDeg: telemetry.frontSlipDeg.toFixed(1),
      rearSlipDeg: telemetry.rearSlipDeg.toFixed(1),
      throttle: snapshot.throttle.toFixed(2),
      brake: snapshot.brake.toFixed(2),
      handbrake: snapshot.handbrake.toFixed(2),
      gradePercent: telemetry.gradePercent.toFixed(2),
    };
    if (slipSpike) {
      console.warn('[DriftForge] Slip spike', payload);
    } else {
      console.log('[DriftForge] Telemetry', payload);
    }
    telemetryLogTimer = 0;
  }
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
    color: 0x5ad2ff,
    metalness: 0.55,
    roughness: 0.35,
    emissive: new THREE.Color(0x133350),
    emissiveIntensity: 0.25,
  });
  const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
  chassis.castShadow = true;
  group.add(chassis);

  const cabinGeometry = new THREE.BoxGeometry(2.2, 1, 2.7);
  const cabinMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f1b33,
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
    color: 0x39d0ff,
    transparent: true,
    opacity: 0.22,
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
    color: 0x20314a,
    roughness: 0.82,
    metalness: 0.08,
  });
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  ground.receiveShadow = true;
  return ground;
}


function createTrackGlow(trackSurface: TrackSurface): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const colorInner = new THREE.Color(0x3de0ff);
  const colorOuter = new THREE.Color(0x001321);

  trackSurface.samples.forEach((sample, index) => {
    const inner = sample.position.clone().addScaledVector(sample.binormal, -sample.width * 0.22);
    const outer = sample.position.clone().addScaledVector(sample.binormal, sample.width * 0.22);
    const normal = sample.normal;

    inner.addScaledVector(normal, 0.05);
    outer.addScaledVector(normal, 0.05);

    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);
    colors.push(colorInner.r, colorInner.g, colorInner.b, colorOuter.r, colorOuter.g, colorOuter.b);

    if (index < trackSurface.samples.length - 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  });

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}
