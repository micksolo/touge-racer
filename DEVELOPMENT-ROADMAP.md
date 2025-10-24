# Drift Forge Roadmap

## Near-Term Handling Goals
- **Pseudo-suspension & weight transfer**  
  Add simple roll/pitch dynamics so lateral/long accelerations shift load realistically and the chassis visually leans.
- **Tire curve & understeer tuning**  
  Adjust slip-to-force curves, throttle/brake weight transfer, and steering limits to reduce high-speed push without reviving hidden assists.
- **Guardrail springs & edge feedback**  
  Replace the soft clamp with spring/damper guardrails plus rumble/shake cues so players feel when they’re flirting with the shoulder.
- **Telemetry QoL**  
  Snapshot slip spikes and expose live tuning controls (sliders) to iterate faster on physics constants.

## Track & Builder Milestones
- Spline editor UI for player-created touge routes (control point gizmos, width/elevation editing).
- Save/load track presets and share codes for “home passes”.
- Procedural scenery pass to add cliffs, trees, and night lighting landmarks.

## Gameplay & Systems Backlog
- Ghost recording/replay with leaderboard and “defend your pass” loop.
- AI rivals that adapt to player track layout and drift style.
- Drift scoring layers: multipliers for switchbacks, consecutive clips, and style points.
- Progression hooks: car upgrades, tuning presets, cosmetic unlocks.

## Visual & Audio Enhancements
- Body roll animation tied to pseudo-suspension states.
- Drift particles, tire smoke, and illuminated guardrails.
- Adaptive soundtrack and rival taunts triggered by scoring streaks.

## Technical Infrastructure
- Telemetry export/import for QA.
- Automated performance budget checks (frame time, draw calls) for WebGL/WebGPU fallback.
- Integration tests for physics regression when constants change.

> _Updated: October 24, 2025_  
Keep adding ideas here as priorities shift.
