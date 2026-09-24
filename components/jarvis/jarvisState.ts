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
    highlightStrength: 0.2, // Checkpoint G: rescaled down from 0.35 alongside the darker base ramp (see JarvisCore3D DEFAULT_PARAMS)
    neuralActivity: 0.0, // Checkpoint E: effectively absent at rest
    // Checkpoint H motion-grammar: "alive but resting" — very low energy
    // participation, very slow field evolution, loose-but-still-continuous
    // structure (coherence<1, not 0 — never fully incoherent/random).
    energyIntensity: 0.32,
    flowSpeed: 0.4,
    coherence: 0.75,
    warmEmphasis: 0.0,
    // Phase 4: no preferred travel direction at rest, minimal irregularity —
    // still not perfectly zero, so the field never reads as switched off.
    directionality: 0.0,
    turbulence: 0.06,
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
    highlightStrength: 0.2, // Checkpoint G: rescaled from 0.35
    neuralActivity: 0.0, // Checkpoint E: receptive, not computationally busy — effectively invisible
    // Checkpoint H motion-grammar: attentive, not energetic — energy
    // participation ticks up from Idle and structure tightens slightly
    // (subtle "gathering"), but flow stays slow — receptive, not busy.
    energyIntensity: 0.42,
    flowSpeed: 0.45,
    coherence: 0.9,
    warmEmphasis: 0.0,
    // Phase 4: receptive, not traveling anywhere — minimal irregularity.
    directionality: 0.0,
    turbulence: 0.05,
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
    highlightStrength: 0.23, // Checkpoint G: rescaled from 0.4
    neuralActivity: 0.32, // Checkpoint E: clearly perceptible — one of the states neural activity (Checkpoint F) targets first
    // Checkpoint H motion-grammar: visibly cognitively active — mid-high
    // participation, moderate flow, organized structure, slight cyan bias
    // (negative warmEmphasis). "Ideas forming and reorganizing."
    energyIntensity: 0.75,
    flowSpeed: 1.0,
    coherence: 1.25,
    warmEmphasis: -0.15,
    // Phase 4: mostly isotropic — internal exploration, no obvious
    // destination — with low turbulence, spatially coherent, not chaotic.
    directionality: 0.08,
    turbulence: 0.18,
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
    highlightStrength: 0.23, // Checkpoint G: rescaled from 0.4
    neuralActivity: 0.36, // Checkpoint E: slightly higher than Thinking — exploratory/distributed character
    // Checkpoint H motion-grammar: more sustained/systematic than Thinking
    // — higher coherence (longer-lived structure) and faster flow, same
    // slight cyan bias. "Information being processed continuously."
    energyIntensity: 0.8,
    flowSpeed: 1.2,
    coherence: 1.4,
    warmEmphasis: -0.15,
    // Phase 4: the largest single jump from Thinking — meaningful, methodical
    // directional travel across the membrane ("systematic traversal"), with
    // low turbulence so the flow itself stays organized, not scattered.
    directionality: 0.55,
    turbulence: 0.16,
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
    highlightStrength: 0.26, // Checkpoint G: rescaled from 0.45
    neuralActivity: 0.4, // Checkpoint E: highest of the non-transient states — decisive/energetic, still controlled
    // Checkpoint H motion-grammar: decisive — highest participation, fastest
    // flow, tightest coherence of the non-transient states. More activity,
    // NOT more randomness — cyan-leaning (computation resolving into
    // execution, not heat).
    energyIntensity: 0.92,
    flowSpeed: 1.5,
    coherence: 1.55,
    warmEmphasis: -0.2,
    // Phase 4: stronger directionality than Researching (execution, not
    // examination) but LOWER turbulence than either Thinking or Researching —
    // "more energy does not mean more chaos"; decisive, less wandering.
    directionality: 0.78,
    turbulence: 0.08,
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
    highlightStrength: 0.23, // Checkpoint G: rescaled from 0.4
    neuralActivity: 0.05, // Checkpoint E: extremely subtle — active but composed, not "thinking"
    // Checkpoint H motion-grammar: resting target only this pass —
    // speechAmplitude-driven modulation is explicitly deferred (Phase 5).
    // Low base participation so the Core stays visually sophisticated even
    // at amplitude 0, per the brief.
    energyIntensity: 0.4,
    flowSpeed: 0.7,
    coherence: 1.0,
    warmEmphasis: 0.0,
    // Phase 5: real resting targets now that speechAmplitude modulation
    // (see motion.ts's getSpeakingModulation) is wired in — these are the
    // QUIET floor a speaking JARVIS settles toward between/before amplitude
    // peaks, not placeholders. Mild directionality (calm-attentive outward
    // character, well below Researching/Acting) rather than 0 — composed,
    // not inert. Turbulence stays at its Phase 4 "minimal for now" value
    // per that checkpoint's explicit state-intent table (unchanged here —
    // amplitude does not modulate turbulence, only the fields above).
    directionality: 0.15,
    turbulence: 0.05,
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
    highlightStrength: 0.23, // Checkpoint G: rescaled from 0.4
    neuralActivity: 0.0, // Checkpoint E: returns toward zero as the transient release settles back to Idle
    // Checkpoint H motion-grammar: brief organized convergence, then the
    // existing auto-return-to-Idle timer eases these back down alongside
    // everything else — no separate "success animation" needed.
    energyIntensity: 0.55,
    flowSpeed: 0.75,
    coherence: 1.15,
    warmEmphasis: -0.1,
    // Phase 4: brief organized convergence, echoing Acting's decisive
    // character, then the auto-return-to-Idle timer eases these down too.
    directionality: 0.3,
    turbulence: 0.05,
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
    highlightStrength: 0.17, // Checkpoint G: rescaled from 0.3
    // Checkpoint E: kept at 0, same reasoning as activityIntensity above —
    // Error is disturbed STRUCTURE, not heightened intelligence. Elevating
    // neuralActivity here would misread as "JARVIS is thinking hard," which
    // is the opposite of what an error should communicate.
    neuralActivity: 0.0,
    // Checkpoint H motion-grammar: controlled instability — LOOSE coherence
    // (fragmented, not organized) and an amber-leaning bias (positive
    // warmEmphasis), consistent with the existing "disturbed FORM, not
    // heightened intelligence" reasoning above. Turbulence modulation is
    // explicitly deferred (Phase 4), so this is the bounded first pass.
    energyIntensity: 0.5,
    flowSpeed: 0.6,
    coherence: 0.55,
    warmEmphasis: 0.35,
    // Phase 4: no purposeful travel direction (disrupted, not decisive) —
    // directionality stays at 0 — but elevated, strictly-bounded turbulence
    // is exactly what makes Error read as fragmented/less-coherent energy
    // rather than merely "low coherence like Idle." The membrane itself
    // remains intact; only ENERGY organization becomes irregular.
    directionality: 0.0,
    turbulence: 0.55,
  },
};
