/**
 * jarvisState.ts — Phase 3: the ONE canonical JARVIS state vocabulary.
 *
 * Pure, framework-agnostic (no React, no Three.js runtime import — only a
 * type-only import of JarvisParams, so this file has zero bundle cost from
 * the renderer). Every other part of the app — the state controller, the
 * dev testing panel, and eventually the Phase 7 backend bridge — imports
 * JarvisState and JARVIS_STATE_PROFILES from HERE and nowhere else. This is
 * what "avoid duplicating state definitions across components" means in
 * practice: one file owns the vocabulary and the target-parameter table.
 */
import type { JarvisParams } from "../JarvisCore3D";

export type JarvisState =
  | "idle"
  | "listening"
  | "thinking"
  | "researching"
  | "acting"
  | "speaking"
  | "complete"
  | "error";

// Ordered for UI presentation (e.g. the dev panel's button grid).
export const JARVIS_STATES: JarvisState[] = [
  "idle",
  "listening",
  "thinking",
  "researching",
  "acting",
  "speaking",
  "complete",
  "error",
];

// Phase 5 preparation, deliberately minimal: a state MAY later carry which
// agent/tool/connection it corresponds to (Researching → "researcher" agent,
// Acting → a specific tool), so pathway illumination has something to key
// off. Nothing reads these fields yet — the type just exists so Phase 5
// doesn't need to change the controller's signature to add them.
export type JarvisStateMeta = {
  activeAgent?: string;
  activeTool?: string;
  activeConnection?: string;
};

// One state → one TARGET profile, expressed purely as overrides on top of
// JarvisCore3D's own DEFAULT_PARAMS (imported and applied by the renderer,
// not duplicated here). Only the fields a state actually needs to move are
// listed — every field NOT listed here stays at its Phase 1/2 locked value
// for every state, which is how "do not retune Phase 2 palette identity"
// stays true even though states are running.
//
// These are deliberately plain, non-animated numbers — the traveling
// pulse/compression *behavior* Thinking and Error describe is Phase 4's
// motion choreography. Phase 3 only sets where each state rests.
export const JARVIS_STATE_PROFILES: Record<JarvisState, Partial<JarvisParams>> = {
  // Default resting state. Equal to JarvisCore3D's own DEFAULT_PARAMS — Idle
  // IS the baseline every other state is a deviation from.
  idle: {
    radius: 0.8,
    displacementIntensity: 1.0,
    compressionAmount: 0.0,
    pulseStrength: 0.0,
    timeScale: 1.0,
    rotationSpeed: 0.055,
    activityIntensity: 0.0,
    highlightStrength: 0.35,
  },

  // Priority interrupt. Expands slightly, goes noticeably still (low
  // rotation, low displacement, slowed noise evolution) while keeping a
  // small nonzero pulse so it never reads as frozen/paused.
  listening: {
    radius: 0.86,
    displacementIntensity: 0.35,
    compressionAmount: 0.0,
    pulseStrength: 0.05,
    timeScale: 0.55,
    rotationSpeed: 0.012,
    activityIntensity: 0.05,
    highlightStrength: 0.35,
  },

  // Slightly condensed (radius down + a touch of compression), more internal
  // activity than Idle, a real but modest pulse for "traveling compression"
  // potential — calm and deliberate, not frantic.
  thinking: {
    radius: 0.75,
    displacementIntensity: 1.15,
    compressionAmount: 0.05,
    pulseStrength: 0.18,
    timeScale: 1.1,
    rotationSpeed: 0.04,
    activityIntensity: 0.15,
    highlightStrength: 0.4,
  },

  // Relatively calm but clearly more active than Idle/Thinking's rotation —
  // "flowing" activity comes from the faster timeScale (the noise field
  // itself evolves quicker) plus a higher activityIntensity than Thinking.
  researching: {
    radius: 0.8,
    displacementIntensity: 1.1,
    compressionAmount: 0.0,
    pulseStrength: 0.1,
    timeScale: 1.25,
    rotationSpeed: 0.09,
    activityIntensity: 0.22,
    highlightStrength: 0.4,
  },

  // Clearly more energetic than Thinking/Researching on every axis, but
  // still bounded — never approaches Error's disturbed/irregular reading.
  acting: {
    radius: 0.82,
    displacementIntensity: 1.35,
    compressionAmount: 0.0,
    pulseStrength: 0.32,
    timeScale: 1.5,
    rotationSpeed: 0.13,
    activityIntensity: 0.32,
    highlightStrength: 0.45,
  },

  // A calm-attentive base profile. The controller (useJarvisController)
  // additively layers a normalized 0–1 speechAmplitude onto pulseStrength /
  // displacementIntensity / activityIntensity ON TOP of these numbers while
  // state === 'speaking' — modulating this SAME body, not a separate
  // waveform visualizer. See SPEECH_GAIN in useJarvisController.ts.
  speaking: {
    radius: 0.8,
    displacementIntensity: 1.0,
    compressionAmount: 0.0,
    pulseStrength: 0.08,
    timeScale: 1.15,
    rotationSpeed: 0.05,
    activityIntensity: 0.12,
    highlightStrength: 0.4,
  },

  // Transient — one elevated "release" target. useJarvisController starts a
  // timer on entering this state and calls setState('idle') automatically;
  // the interpolation layer eases the elevated pulse back down to Idle's
  // resting values as part of that same return, so it reads as a pulse-then-
  // settle even before Phase 4 authors the real choreography.
  complete: {
    radius: 0.84,
    displacementIntensity: 1.2,
    compressionAmount: 0.0,
    pulseStrength: 0.5,
    timeScale: 1.0,
    rotationSpeed: 0.055,
    activityIntensity: 0.1,
    highlightStrength: 0.4,
  },

  // Controlled instability: contraction (lower radius + real
  // compressionAmount) and a disturbed pulse/displacement — NOT a color
  // change. activityIntensity is deliberately left at 0 here: an error is
  // communicated through disturbed FORM, not by forcing the body warm/hot,
  // which would both fight the "no generic flashing-red alarm" instruction
  // and blur the meaning of warm color as "computational activity."
  error: {
    radius: 0.72,
    displacementIntensity: 1.4,
    compressionAmount: 0.08,
    pulseStrength: 0.4,
    timeScale: 0.7,
    rotationSpeed: 0.02,
    activityIntensity: 0.0,
    highlightStrength: 0.3,
  },
};
