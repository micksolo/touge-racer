# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Drift Forge** (working title: touge-racer) is a browser-based drift racing game built with Three.js and TypeScript. The game features a mountain touge (mountain pass) racing experience with realistic drift physics, dynamic camera work, and arcade-style scoring mechanics.

## Build Commands

```bash
# Development server with hot reload
npm run dev

# Type-check and build for production
npm run build

# Preview production build locally
npm run preview
```

## Architecture Overview

### Core Modules

The codebase follows a modular architecture with clear separation of concerns:

- **main.ts**: Application entry point, scene setup, rendering loop, HUD/debug UI, and visual components (car model, environment, lighting)
- **carPhysics.ts**: Vehicle dynamics simulation using simplified bicycle model with slip angles, weight transfer, tire forces, and drift scoring
- **track.ts**: Procedural track generation using Catmull-Rom splines with Frenet frames for surface normals, banking, and width profiles
- **input.ts**: Keyboard input handling for steering, throttle, brake, and handbrake controls

### Physics Architecture

The car physics system (carPhysics.ts) implements a simplified bicycle model with:

- **Tire slip angles**: Front/rear axle slip computed from lateral velocity and yaw rate
- **Cornering forces**: Pacejka-style tire model using `tanh` for progressive grip loss
- **Weight transfer**: Dynamic load distribution based on throttle/brake input affecting grip
- **High-speed tuning**: Speed-dependent steering limits and grip scaling to prevent understeer
- **Drift mechanics**: Handbrake-triggered oversteer with yaw boost and rear grip reduction

Key physics parameters are exposed via `CarConfig` and can be adjusted through live tuning sliders when debug mode is enabled (press `P`).

### Track System

The track (track.ts) is procedurally generated from control points:

1. Control points define the 3D path of the mountain pass
2. `CatmullRomCurve3` interpolates smooth curves between points
3. Frenet frames compute tangent, normal, and binormal vectors for each track segment
4. Banking and elevation undulations are applied procedurally
5. Width profiles create dynamic track narrowing/widening (e.g., canyon sections)
6. A canvas-based texture with lane markings is generated at runtime

The `TrackSurface` class provides `projectPoint()` to snap the car to the track surface and `getSampleAtDistance()` for spline-based queries.

### Rendering & Camera

- **Camera**: Third-person follow camera with smooth lerp tracking, speed-dependent distance, and surface-aligned up vector
- **Lighting**: ACES filmic tone mapping with directional sun, hemisphere light, rim light, and ambient occlusion
- **Shadows**: Enabled on car chassis and track surface
- **Car visual**: Simple box geometry for chassis/cabin with cylindrical wheels that animate based on velocity

### Debug & Telemetry

Press `P` to toggle debug mode, which shows:

- Real-time telemetry bars for steering input, slip angles, yaw rate, and speed components
- Live tuning sliders for physics parameters (steering response, grip scaling, weight transfer, handbrake behavior)
- Console logging at 600ms intervals or when slip angle spikes are detected

Telemetry logs include progress (meters/percent), steering angles, slip angles, and input values.

## Development Patterns

### Coordinate Systems

- **World space**: Three.js right-handed Y-up coordinate system
- **Car local space**: 2D velocity decomposed into longitudinal (forward/back) and lateral (left/right) components
- **Track space**: Frenet frame with tangent (forward), normal (up), and binormal (right) vectors

### State Management

- `CarState`: Mutable state updated each frame in `stepCar()`
- `CarConfig`: Immutable physics configuration created at initialization
- `InputSnapshot`: Immutable capture of keyboard state each frame
- `CarTelemetry`: Read-only output of physics simulation for HUD/debug display

### Physics Integration

- Fixed timestep clamped to 50ms maximum (20 FPS minimum)
- Semi-implicit Euler integration: velocity updated before position
- Yaw rate limited to prevent unrealistic spinning
- Lateral clamping to track boundaries with velocity correction to prevent wall penetration

## Key Implementation Details

### Drift Scoring

Drift score accumulates when slip angle exceeds `driftThresholdDeg` (30°) at speeds above `minDriftSpeed` (9 m/s). Score multipliers apply for:

- Grade steepness (1.5x at 6%, 2x at 10%+)
- Combo duration (up to 1.75x after 5 seconds)

### High-Speed Handling

To address high-speed understeer, the following mechanisms are implemented:

- `frontGripHighSpeedScale` and `rearGripHighSpeedScale` reduce tire forces at speed
- `highSpeedSteerLimit` reduces steering angle to 38% of max at full speed
- `yawRateLimit` caps rotational velocity to 26°/s
- Speed-dependent steering rate interpolates from slow (120°/s) to fast (38°/s)

### Track Projection

The `projectPoint()` method uses brute-force segment iteration to find the closest point on the track centerline. This is acceptable for the current track complexity (~1200 segments) but may need spatial acceleration (e.g., BVH) for longer tracks.

### Road Texture Generation

The track surface uses a procedurally generated canvas texture with:

- Gradient fill for base asphalt color
- Random noise particles for surface detail
- White edge lines for track boundaries
- Yellow dashed center lines with configurable spacing/height

## Code Conventions

- TypeScript with strict mode enabled
- ESM modules with top-level exports
- Three.js vector/math utilities preferred over manual calculations
- Type safety enforced via interfaces (`CarSpec`, `CarConfig`, `TrackSample`, etc.)
- No external physics engine (custom implementation for learning/control)
