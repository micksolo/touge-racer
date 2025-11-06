# Changelog

All notable changes to Touge Racer will be documented in this file.

## [2025-01-06] feat: complete cannon-es physics integration

**Major rewrite**: Replaced arcade physics with cannon-es RaycastVehicle system.

### Added
- Cannon-es RaycastVehicle with 4-wheel suspension physics
- Segmented box collision system (900 oriented boxes for 3.3km track)
- Guardrails: 720 wall segments prevent driving off track
- Local-space camera following with quaternion transforms
- Debug visualization for collision boxes (wireframe)

### Technical Implementation
- **Track collision**: Oriented boxes using Frenet frames (tangent/normal/binormal)
- **Quaternion math**: Proper rotation matrix construction from track basis
- **Normal flipping**: Track normals point down, collision needs up
- **Suspension tuning**: Stiffness 100, damping 8.0/5.0, rest length 0.5m
- **Stability**: Angular damping 0.8, lowered center of mass (-0.5)
- **Performance**: ~1620 static bodies, 240 raycasts/sec, smooth 60 FPS

### Fixed
- Resolved wheel raycast detection (required `world.step()` initialization)
- Fixed box orientation (was nearly vertical, now properly aligned)
- Eliminated bouncing/stair-stepping on curved track
- Prevented handbrake nose-dive (95% rear braking)
- Removed chassis collision interference

### Removed
- All arcade physics code (carPhysics.ts)
- Broken cannon-es attempts (carPhysicsCannon.ts)
- Track editor (trackEditor3D.ts)
- Bicycle physics backup files

### Documentation
- Created README.md with system overview
- Updated CANNON_ES_ISSUES.md with solution
- See commit history on `cannon-test-minimal` branch for full debugging journey

## [Unreleased]
- Drift physics tuning for cannon-es
- AI opponents
- Telemetry/replay system

## [2025-10-24] feat: add lane texture, physics telemetry, and stability tuning
- Added canvas-based road texture with lane markings.
- Introduced keyboard-toggle debug HUD with physics telemetry and console logging.
- Tuned high-speed steering limits, grip scaling, and edge clamps to remove phantom forces.

## [2025-10-24] chore: initial drift forge prototype
- Scaffolded Vite + TypeScript project with Three.js.
- Implemented base track mesh, car controller, and rendering loop.
