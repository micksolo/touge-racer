# Touge Racer

A drift racing game built with Three.js and Cannon-es physics, featuring realistic vehicle dynamics on mountain pass (touge) tracks.

## Features

- **Cannon-es RaycastVehicle Physics** - Realistic suspension, weight transfer, and handling
- **Segmented Box Collision** - 3.3km mountain track with oriented collision boxes following track surface
- **Mountain Pass Track** - Winding touge-style road with elevation changes and technical corners
- **Guardrails** - Prevent driving off the mountain
- **Follow Camera** - Smooth camera that stays behind the car in local space

## Controls

- **W / ↑** - Accelerate
- **S / ↓** - Reverse
- **A / ←** - Steer Left
- **D / →** - Steer Right
- **Space** - Handbrake

## Technical Architecture

### Physics System
- **Engine**: Cannon-es v0.20.0
- **Vehicle Type**: RaycastVehicle (4 wheels with suspension)
- **Collision Detection**: 900 oriented box bodies (5m segments)
- **Performance**: ~1620 static bodies, 240 raycasts/sec, 60 FPS

### Track Collision System
Track collision uses **segmented oriented boxes** instead of triangle meshes:

1. **Spline Generation** (`track.ts`)
   - CatmullRom curve through control points
   - 1800 samples with tangent/normal/binormal vectors (Frenet frames)
   - 24m wide road surface

2. **Collision Box Generation** (`trackCollision.ts`)
   - Boxes every 5 meters along track
   - Oriented using quaternions from track basis vectors
   - 10cm overlap to prevent seam gaps
   - Guardrails: 720 wall segments (360 per side)

3. **Orientation Math**
   - **Normal flipped**: Track normals point down, collision boxes need up
   - **Basis**: right=binormal, up=flipped normal, forward=tangent
   - **Matrix**: Build rotation matrix from orthonormal basis → quaternion

### Vehicle Configuration
```typescript
// Chassis
mass: 150kg
angularDamping: 0.8 (prevent flipping)
centerOfMass: (0, -0.5, 0) (low for stability)

// Suspension
stiffness: 100
restLength: 0.5m
damping: compression=8.0, relaxation=5.0
maxForce: 10000N
```

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5174

## Project History

This project started with arcade physics but switched to cannon-es for more realistic vehicle simulation. The initial cannon-es implementation had issues documented in `CANNON_ES_ISSUES.md` (tumbling, falling through track). These were resolved by:

1. Proper quaternion math for box orientation
2. Flipping track normals (were pointing down)
3. Initializing collision detection with `world.step()` before raycasts
4. Tuning suspension parameters

See `CANNON_ES_ISSUES.md` for the full debugging journey.

## Files

- `src/cannonTest.ts` - Main vehicle and scene setup
- `src/trackCollision.ts` - Collision box generation system
- `src/track.ts` - Track spline generation
- `src/input.ts` - Keyboard input handling
- `src/main.ts` - Entry point

## License

MIT
