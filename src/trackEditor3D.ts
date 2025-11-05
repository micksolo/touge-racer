import * as THREE from 'three';
import { TrackSurface, saveTrackToStorage, resetTrackToDefault } from './track';

export class TrackEditor3D {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private controlPoints: THREE.Vector3[];
  private gizmoGroups: THREE.Group[] = [];
  private gizmoArrows: THREE.Mesh[] = [];
  private selectedArrow: THREE.Mesh | null = null;
  private hoveredArrow: THREE.Mesh | null = null;
  private raycaster: THREE.Raycaster;
  private pointer: THREE.Vector2;
  private dragStartPoint: THREE.Vector3 = new THREE.Vector3();
  private dragStartCameraPos: THREE.Vector3 = new THREE.Vector3();
  private isDragging: boolean = false;
  private isEnabled: boolean = false;
  private history: THREE.Vector3[][] = [];
  private trackWidth: number;
  private trackSegments: number;
  private onTrackUpdated: (track: TrackSurface) => void;
  private getCarPosition: () => THREE.Vector3;

  // Camera controls
  private cameraRotating: boolean = false;
  private cameraPanning: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private cameraYaw: number = 0;
  private cameraPitch: number = 0;
  private cameraKeys: Set<string> = new Set();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    initialPoints: THREE.Vector3[],
    trackWidth: number,
    trackSegments: number,
    onTrackUpdated: (track: TrackSurface) => void,
    getCarPosition: () => THREE.Vector3
  ) {
    this.scene = scene;
    this.camera = camera;
    this.controlPoints = initialPoints.map(p => p.clone());
    this.trackWidth = trackWidth;
    this.trackSegments = trackSegments;
    this.onTrackUpdated = onTrackUpdated;
    this.getCarPosition = getCarPosition;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.createGizmos();
    this.saveToHistory();
  }

  private createGizmos() {
    // Remove existing gizmos
    this.gizmoGroups.forEach(group => this.scene.remove(group));
    this.gizmoGroups = [];
    this.gizmoArrows = [];

    const arrowLength = 12;
    const arrowHeadLength = 3;
    const arrowHeadWidth = 2;
    const shaftRadius = 0.4;

    this.controlPoints.forEach((point, index) => {
      const gizmoGroup = new THREE.Group();
      gizmoGroup.position.copy(point);
      gizmoGroup.userData.index = index;

      // Create 3 arrows: X (red), Y (green), Z (blue)
      const axes = [
        { dir: new THREE.Vector3(1, 0, 0), color: 0xff0000, axis: 'x' }, // Red X
        { dir: new THREE.Vector3(0, 1, 0), color: 0x00ff00, axis: 'y' }, // Green Y
        { dir: new THREE.Vector3(0, 0, 1), color: 0x0000ff, axis: 'z' }, // Blue Z
      ];

      axes.forEach(({ dir, color, axis }) => {
        // Arrow shaft (cylinder)
        const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, arrowLength, 8);
        const shaftMaterial = new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
        });
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.position.y = arrowLength / 2;
        shaft.renderOrder = 999;

        // Arrow head (cone) - rotated 180° so apex points up
        const headGeometry = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
        const headMaterial = new THREE.MeshBasicMaterial({
          color,
          depthTest: false,
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.rotation.x = Math.PI; // Flip cone upside down so apex points up
        head.position.y = arrowLength + arrowHeadLength / 2;
        head.renderOrder = 999;

        // Combine shaft and head into arrow group
        const arrowGroup = new THREE.Group();
        arrowGroup.add(shaft);
        arrowGroup.add(head);

        // Rotate to point in correct direction
        if (axis === 'x') {
          arrowGroup.rotation.z = -Math.PI / 2;
        } else if (axis === 'z') {
          arrowGroup.rotation.x = Math.PI / 2;
        }
        // Y axis stays pointing up (no rotation needed)

        // Store metadata
        arrowGroup.userData.controlIndex = index;
        arrowGroup.userData.axis = axis;
        arrowGroup.userData.direction = dir.clone();

        gizmoGroup.add(arrowGroup);

        // Make shaft and head both interactive
        shaft.userData = arrowGroup.userData;
        head.userData = arrowGroup.userData;
        this.gizmoArrows.push(shaft, head);
      });

      this.gizmoGroups.push(gizmoGroup);
      if (this.isEnabled) {
        this.scene.add(gizmoGroup);
      }
    });
  }

  enable() {
    this.isEnabled = true;
    this.gizmoGroups.forEach(group => this.scene.add(group));

    // Position camera to look down the track (negative Z direction)
    const carPos = this.getCarPosition();
    console.log('🚗 Car position:', carPos);
    console.log('📍 Control points:', this.controlPoints.length);

    // Position camera BEHIND car (positive Z), elevated, looking down track (negative Z)
    this.camera.position.set(carPos.x + 30, carPos.y + 40, carPos.z + 80);
    console.log('📷 Camera position:', this.camera.position);

    // Look down the track (negative Z direction) - pick a point ahead
    const lookTarget = new THREE.Vector3(carPos.x, carPos.y, carPos.z - 100);
    this.camera.lookAt(lookTarget);
    console.log('🎯 Looking at:', lookTarget);

    // Calculate initial yaw and pitch from camera orientation
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.cameraYaw = Math.atan2(direction.x, direction.z);
    this.cameraPitch = Math.asin(-direction.y);

    console.log('✅ Editor enabled - gizmos:', this.gizmoGroups.length);
    console.log('   WASD = fly | Left-drag = pan | Right-drag = rotate | Scroll = zoom');
  }

  disable() {
    this.isEnabled = false;
    this.gizmoGroups.forEach(group => this.scene.remove(group));
    this.selectedArrow = null;
    this.hoveredArrow = null;
    this.isDragging = false;
  }

  isActive(): boolean {
    return this.isEnabled;
  }

  onPointerDown(event: MouseEvent) {
    if (!this.isEnabled) return;

    // Right click for camera rotation
    if (event.button === 2) {
      this.cameraRotating = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      return;
    }

    // Left click
    if (event.button === 0) {
      this.updatePointer(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);

      const intersects = this.raycaster.intersectObjects(this.gizmoArrows);
      if (intersects.length > 0) {
        // Clicked on an arrow - start dragging
        this.selectedArrow = intersects[0].object as THREE.Mesh;
        // Highlight selected arrow
        (this.selectedArrow.material as THREE.MeshBasicMaterial).color.setHex(0xffff00); // Yellow
        this.isDragging = true;

        // Store initial world position and camera position for dragging
        const controlIndex = this.selectedArrow.userData.controlIndex;
        this.dragStartPoint.copy(this.controlPoints[controlIndex]);
        this.dragStartCameraPos.copy(this.camera.position);
      } else {
        // Clicked on empty space - start panning camera
        this.cameraPanning = true;
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
      }
    }
  }

  onPointerMove(event: MouseEvent) {
    if (!this.isEnabled) return;

    // Handle camera rotation
    if (this.cameraRotating) {
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;
      this.cameraYaw -= deltaX * 0.003;
      this.cameraPitch -= deltaY * 0.003;
      this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      return;
    }

    // Handle camera panning
    if (this.cameraPanning) {
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;
      const panSpeed = 0.15;

      // Right vector (perpendicular to forward)
      const right = new THREE.Vector3(
        Math.cos(this.cameraYaw),
        0,
        -Math.sin(this.cameraYaw)
      );

      // Up vector (always world up for panning)
      const up = new THREE.Vector3(0, 1, 0);

      // Pan camera (inverted Y so drag up = move up)
      this.camera.position.addScaledVector(right, -deltaX * panSpeed);
      this.camera.position.addScaledVector(up, -deltaY * panSpeed);

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      return;
    }

    // Handle arrow dragging
    if (this.isDragging && this.selectedArrow) {
      this.updatePointer(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);

      const controlIndex = this.selectedArrow.userData.controlIndex;
      const axis = this.selectedArrow.userData.axis;
      const axisDirection = this.selectedArrow.userData.direction;

      // Current control point position
      const currentPoint = this.controlPoints[controlIndex];

      // Project mouse ray onto the axis
      // Find closest point on axis to the ray
      const rayOrigin = this.raycaster.ray.origin;
      const rayDir = this.raycaster.ray.direction;

      // Line-to-line closest point
      const w = new THREE.Vector3().subVectors(rayOrigin, currentPoint);
      const a = rayDir.dot(rayDir);
      const b = rayDir.dot(axisDirection);
      const c = axisDirection.dot(axisDirection);
      const d = rayDir.dot(w);
      const e = axisDirection.dot(w);

      const denom = a * c - b * b;
      if (Math.abs(denom) > 0.0001) {
        const t = (b * e - c * d) / denom;
        const s = (a * e - b * d) / denom;

        // New position along axis
        const newPoint = currentPoint.clone().addScaledVector(axisDirection, s);

        // Update control point
        this.controlPoints[controlIndex].copy(newPoint);

        // Update gizmo position
        this.gizmoGroups[controlIndex].position.copy(newPoint);

        this.rebuildTrack();
      }
    } else {
      // Track hover state for visual feedback
      this.updatePointer(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const intersects = this.raycaster.intersectObjects(this.gizmoArrows);
      this.hoveredArrow = intersects.length > 0 ? (intersects[0].object as THREE.Mesh) : null;
    }
  }

  onPointerUp() {
    if (!this.isEnabled) return;

    this.cameraRotating = false;
    this.cameraPanning = false;

    if (this.isDragging && this.selectedArrow) {
      this.saveToHistory();
    }

    if (this.selectedArrow) {
      // Restore original color based on axis
      const axis = this.selectedArrow.userData.axis;
      const originalColor = axis === 'x' ? 0xff0000 : axis === 'y' ? 0x00ff00 : 0x0000ff;
      (this.selectedArrow.material as THREE.MeshBasicMaterial).color.setHex(originalColor);
    }
    this.selectedArrow = null;
    this.isDragging = false;
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.isEnabled) return;
    this.cameraKeys.add(event.code);
  }

  onKeyUp(event: KeyboardEvent) {
    if (!this.isEnabled) return;
    this.cameraKeys.delete(event.code);
  }

  updateCamera(dt: number) {
    if (!this.isEnabled) return;

    const moveSpeed = 80 * dt;

    // Forward direction respects pitch (camera angle up/down)
    const forward = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
    );

    // Right direction stays horizontal
    const right = new THREE.Vector3(
      Math.cos(this.cameraYaw),
      0,
      -Math.sin(this.cameraYaw)
    );

    let moved = false;
    if (this.cameraKeys.has('KeyW')) {
      this.camera.position.addScaledVector(forward, moveSpeed);
      moved = true;
    }
    if (this.cameraKeys.has('KeyS')) {
      this.camera.position.addScaledVector(forward, -moveSpeed);
      moved = true;
    }
    if (this.cameraKeys.has('KeyA')) {
      this.camera.position.addScaledVector(right, -moveSpeed);
      moved = true;
    }
    if (this.cameraKeys.has('KeyD')) {
      this.camera.position.addScaledVector(right, moveSpeed);
      moved = true;
    }
    if (this.cameraKeys.has('KeyQ') || this.cameraKeys.has('ShiftLeft') || this.cameraKeys.has('ShiftRight')) {
      this.camera.position.y -= moveSpeed;
      moved = true;
    }
    if (this.cameraKeys.has('Space')) {
      this.camera.position.y += moveSpeed;
      moved = true;
    }

    // Apply camera rotation
    const target = new THREE.Vector3(
      this.camera.position.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      this.camera.position.y + Math.sin(this.cameraPitch),
      this.camera.position.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
    );
    this.camera.lookAt(target);
  }

  onWheel(event: WheelEvent) {
    if (!this.isEnabled || event.shiftKey) return;

    event.preventDefault();

    // If hovering over a Y-axis arrow, adjust its elevation
    if (this.hoveredArrow && this.hoveredArrow.userData.axis === 'y') {
      const delta = event.deltaY > 0 ? -0.5 : 0.5;
      const controlIndex = this.hoveredArrow.userData.controlIndex;
      this.controlPoints[controlIndex].y += delta;
      this.gizmoGroups[controlIndex].position.y += delta;
      this.rebuildTrack();
      this.saveToHistory();
    } else {
      // Otherwise, zoom camera in/out (scroll up = zoom in)
      const zoomSpeed = 2.0;
      const delta = event.deltaY > 0 ? -zoomSpeed : zoomSpeed;

      // Move camera forward/backward in the direction it's facing
      const forward = new THREE.Vector3(
        Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
        Math.sin(this.cameraPitch),
        Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
      );
      this.camera.position.addScaledVector(forward, delta);
    }
  }

  private updatePointer(event: MouseEvent) {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private rebuildTrack() {
    const curve = new THREE.CatmullRomCurve3(this.controlPoints, false, 'centripetal', 0.12);
    const newTrack = new TrackSurface({
      curve,
      width: this.trackWidth,
      segments: this.trackSegments
    });
    this.onTrackUpdated(newTrack);
  }

  private saveToHistory() {
    const snapshot = this.controlPoints.map(p => p.clone());
    this.history.push(snapshot);
    if (this.history.length > 20) {
      this.history.shift();
    }
  }

  undo() {
    if (this.history.length > 1) {
      this.history.pop(); // Remove current state
      const previousState = this.history[this.history.length - 1];
      this.controlPoints = previousState.map(p => p.clone());
      this.createGizmos();
      this.rebuildTrack();
      console.log('✓ Undo applied');
    } else {
      console.log('✗ Nothing to undo');
    }
  }

  save() {
    saveTrackToStorage(this.controlPoints);
    alert('Track saved! It will load automatically next time.');
  }

  revert() {
    if (this.history.length > 0) {
      const originalState = this.history[0];
      this.controlPoints = originalState.map(p => p.clone());
      this.history = [originalState.map(p => p.clone())];
      this.createGizmos();
      this.rebuildTrack();
      console.log('✓ Reverted to session start');
    }
  }

  resetToDefault() {
    resetTrackToDefault();
    alert('Track reset to default! Reload the page to see the default track.');
  }
}
