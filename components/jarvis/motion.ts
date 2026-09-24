/**
 * motion.ts — Phase 4: the motion/transition layer.
 *
 * Pure, framework-agnostic (no React, no Three.js runtime import — only a
 * type-only import of JarvisState). This file is the canonical home of the
 * THREE concepts Phase 4 explicitly asks to keep separate:
 *
 *   1. TRANSITION TIMING  — TRANSITION_TAU / getTau(): how quickly each
 *      tweenable parameter eases toward its (Phase 3) state target, varying
 *      by state AND by parameter. Replaces Phase 3's single global TAU.
 *
 *   2. CONTINUOUS IN-STATE MOTION — getContinuousMotion(): small, ongoing,
 *      non-repeating procedural offsets layered on top of the settled
 *      values while a state remains active (Idle's breathing, Thinking's
 *      traveling pulses, Error's irregular jitter, …). These are ADDITIVE
 *      overlays computed fresh every frame from the current time — they are
 *      never fed back into the eased "live" values, so they never
 *      accumulate or drift the settle point.
 *
 *   3. TRANSIENT ENVELOPES — getCompleteEnvelope() / getSpeakingModulation():
 *      one-shot or continuously-driven procedural modifiers for events that
 *      aren't just "ease toward a target" (Complete's rise-then-fall release
 *      pulse; Speaking's live speech-amplitude resonance).
 *
 * JarvisCore3D (the renderer) imports and calls these functions from its
 * existing per-frame loop; it never branches on JarvisState itself — all the
 * "what does state X actually do" authorship lives here, per the Phase 4
 * architecture instruction ("if state-aware logic is genuinely necessary,
 * isolate it in the motion/controller layer rather than the renderer").
 */
import type { JarvisState } from "./jarvisState";
import type { JarvisParams } from "../JarvisCore3D";

// The subset of JarvisParams the state engine actually varies (see
// jarvisState.ts's JARVIS_STATE_PROFILES). Canonical home — JarvisCore3D
// imports this rather than redeclaring it.
export const TWEENABLE_KEYS = [
  "radius",
  "displacementIntensity",
  "compressionAmount",
  "pulseStrength",
  "timeScale",
  "rotationSpeed",
  "activityIntensity",
  "highlightStrength",
  "neuralActivity", // Phase 8 Checkpoint E — tweened now, visually wired in Checkpoint F
  // Checkpoint H motion-grammar pass — the cognitive-energy dimensions
  "energyIntensity",
  "flowSpeed",
  "coherence",
  "warmEmphasis",
  // Phase 4 — cognitive directionality + controlled energy turbulence.
  // Both affect ONLY the energy field (see energyMask() in JarvisCore3D);
  // never geometry/displacement/particleSize/camera/depth/opacity.
  "directionality",
  "turbulence",
  // Membrane Expression Sub-Phase 1 — the ONE coherent-fold amplitude knob.
  // This is a PHYSICAL displacement parameter (unlike everything above it in
  // this list since Checkpoint H, which are energy/cognition-only) — it
  // rides the same tween architecture but feeds the vertex shader's `field`
  // accumulator alongside ampA/ampB/ampC, not the fragment-shader energy
  // system. See foldField() in JarvisCore3D's vertex shader.
  "ampFold",
  // Membrane Expression Sub-Phase 2 — Fold #2's independent amplitude.
  // Deliberately separate from ampFold (not a shared knob) so dominance
  // between the two folds is independently controllable, per this
  // sub-phase's "one dominant + one subordinate" requirement.
  "ampFold2",
] as const;

export type TweenKey = (typeof TWEENABLE_KEYS)[number];
export type TweenValues = Record<TweenKey, number>;
type PartialTween = Partial<TweenValues>;

// ═══════════════════════════ 1. TRANSITION TIMING ═══════════════════════════
// Exponential time-constant per (state, parameter): live += (target-live) *
// (1 - exp(-dt/tau)). Smaller tau = faster settle. Unlisted combinations fall
// back to DEFAULT_TAU (~1s to ~90% settled — a safe, unremarkable default).
//
// The brief's guidance translated into numbers: Listening fastest (~0.15–0.3s
// tau → substantially settled well under 1s); Thinking/Researching more
// deliberate (~0.4–0.6s); Acting ramps energetically but smoothly (~0.3s on
// the energy parameters); Error reads as an immediate but not instant
// disruption (~0.2–0.3s); Complete's RISE is fast (its own envelope below
// handles the shape) so tau here only needs to get the state target's own
// baseline into place promptly.
const DEFAULT_TAU = 0.45;

export const TRANSITION_TAU: Record<JarvisState, PartialTween> = {
  idle: {
    rotationSpeed: 0.5,
    pulseStrength: 0.5,
    displacementIntensity: 0.5,
    // Checkpoint H motion-grammar: slow, calm settle — matches idle's
    // generally unhurried character among the other taus here.
    energyIntensity: 0.6,
    flowSpeed: 0.8,
    coherence: 0.9,
    warmEmphasis: 0.6,
    // Phase 4: slow release back to isotropic/near-still — "the organized
    // motion should slowly release back into quiet background cognition."
    directionality: 0.9,
    turbulence: 0.6,
  },
  // Fastest of all eight — "I stopped and I am paying attention." Radius
  // (the expand) takes a touch longer than rotation/pulse settling, which is
  // deliberate: the attentive POSTURE (still, quiet) reads first, the
  // physical expand completes a beat after.
  listening: {
    rotationSpeed: 0.12,
    timeScale: 0.18,
    displacementIntensity: 0.22,
    pulseStrength: 0.18,
    activityIntensity: 0.22,
    radius: 0.32,
    compressionAmount: 0.2,
    neuralActivity: 0.22, // fast settle to its (near-zero) target, same character as activityIntensity here
    energyIntensity: 0.25,
    flowSpeed: 0.3,
    coherence: 0.35,
    warmEmphasis: 0.3,
    directionality: 0.3,
    turbulence: 0.3,
  },
  thinking: {
    compressionAmount: 0.22,
    radius: 0.3,
    pulseStrength: 0.3,
    rotationSpeed: 0.5,
    activityIntensity: 0.35,
    neuralActivity: 0.35,
    energyIntensity: 0.4,
    flowSpeed: 0.55,
    coherence: 0.6,
    warmEmphasis: 0.45,
    directionality: 0.6,
    turbulence: 0.5,
  },
  // Phase 4: directionality's tau is deliberately the SLOWEST of the
  // cognitive-energy dimensions here — "the existing exploratory activity
  // should gradually begin developing directional organization" (Thinking →
  // Researching), not snap into a traveling flow.
  researching: {
    rotationSpeed: 0.4,
    timeScale: 0.35,
    activityIntensity: 0.4,
    neuralActivity: 0.4,
    energyIntensity: 0.4,
    flowSpeed: 0.5,
    coherence: 0.55,
    warmEmphasis: 0.45,
    directionality: 0.85,
    turbulence: 0.5,
  },
  // Phase 4: directionality/turbulence settle FASTER than Researching's —
  // "the directional flow should gradually tighten and become more
  // decisive," i.e. uncertainty collapsing into execution reads as a
  // relatively prompt resolve, not a slow drift.
  acting: {
    pulseStrength: 0.3,
    displacementIntensity: 0.3,
    rotationSpeed: 0.32,
    activityIntensity: 0.3,
    neuralActivity: 0.3,
    energyIntensity: 0.3,
    flowSpeed: 0.35,
    coherence: 0.4,
    warmEmphasis: 0.35,
    directionality: 0.4,
    turbulence: 0.28,
  },
  speaking: {
    pulseStrength: 0.25,
    activityIntensity: 0.25,
    displacementIntensity: 0.3,
    neuralActivity: 0.25,
    energyIntensity: 0.35,
    flowSpeed: 0.4,
    coherence: 0.45,
    warmEmphasis: 0.4,
    directionality: 0.4,
    turbulence: 0.35,
  },
  // The rise is carried by getCompleteEnvelope's own attack/decay shape, not
  // by this tau — kept moderate so the state target's baseline (radius,
  // displacementIntensity) arrives without a visible snap underneath the
  // envelope.
  complete: {
    pulseStrength: 0.2,
    radius: 0.25,
    displacementIntensity: 0.25,
    energyIntensity: 0.3,
    flowSpeed: 0.35,
    coherence: 0.4,
    warmEmphasis: 0.35,
    directionality: 0.35,
    turbulence: 0.3,
  },
  // Fast-ish but not instant — "immediately disrupted, not a hard cut."
  // directionality settles toward its own near-zero target quickly (Error is
  // NOT purposeful/directed), while turbulence's rise is the primary carrier
  // of "controlled irregularity."
  error: {
    compressionAmount: 0.2,
    pulseStrength: 0.22,
    displacementIntensity: 0.25,
    rotationSpeed: 0.3,
    timeScale: 0.28,
    energyIntensity: 0.3,
    flowSpeed: 0.35,
    coherence: 0.3,
    warmEmphasis: 0.3,
    directionality: 0.3,
    turbulence: 0.3,
  },
};

export function getTau(state: JarvisState, key: TweenKey): number {
  return TRANSITION_TAU[state]?.[key] ?? DEFAULT_TAU;
}

// ═══════════════════════════ shared procedural helper ═══════════════════════
// Sum of a few incommensurate-frequency sine waves — quasi-periodic, not
// truly random, but its effective repeat period is on the order of minutes
// (the slowest term alone is ~270s), which is what "avoid obvious short
// loops" / "avoid relying primarily on sin(time) with a short fixed period"
// actually calls for without pulling in a CPU noise library for a handful of
// scalars. `seed` decorrelates independent uses of the same time value.
function quasi(t: number, seed: number): number {
  return (
    Math.sin(t * 0.17 + seed * 1.7) * 0.5 +
    Math.sin(t * 0.071 + seed * 3.1 + 1.3) * 0.33 +
    Math.sin(t * 0.023 + seed * 5.9 + 2.7) * 0.17
  );
}

// Sparse, sharp-ish positive bumps from the same quasi field — reads as
// occasional surges/pulses rather than a constantly-elevated floor. Used for
// "traveling pulse" style continuous motion (Thinking, Acting, Error).
function quasiPulse(t: number, seed: number): number {
  return Math.pow(Math.max(0, quasi(t, seed)), 3);
}

// Tiny always-on wobble on the body's tilt axis (independent of state) so
// even a single fixed rotation axis doesn't read as a mechanical turntable.
// ~±1.7° at its extreme, far too slow and small to be disorienting.
export function getTiltWobble(t: number): number {
  return quasi(t, 42) * 0.03;
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ═══════════════ Membrane Expression Sub-Phase 1: fold reference ═══════════
// Two GLOBAL (not per-particle) wandering unit vectors that the vertex
// shader's foldField() reads every particle against — computed ONCE per
// frame here on the CPU (cheaper than 18,000 repeated evaluations in the
// shader) using the SAME quasi() non-looping technique already validated
// elsewhere in this file, just with fresh seeds.
//
// `center` marks where the fold currently sits on the sphere. `axis` marks
// the crease's grain — critically, it is Gram-Schmidt–orthogonalized
// against `center` (projected into the tangent plane at that point, then
// renormalized) so it is always TANGENT to the sphere there. That is what
// keeps the ridge/valley crease spanning the fold's cap symmetrically —
// without it, an axis that happened to point partly toward/away from center
// would skew or collapse the crease instead of splitting the cap evenly.
export function getFoldReference(t: number): {
  center: [number, number, number];
  axis: [number, number, number];
} {
  const rawCenter: [number, number, number] = [
    quasi(t, 61) + 0.4 * quasi(t * 0.6, 62.5),
    quasi(t, 63) + 0.4 * quasi(t * 0.6, 64.5),
    quasi(t, 65) + 0.4 * quasi(t * 0.6, 66.5),
  ];
  const center = normalize3(rawCenter);

  const rawAxis: [number, number, number] = [
    quasi(t, 71) + 0.4 * quasi(t * 0.6, 72.5),
    quasi(t, 73) + 0.4 * quasi(t * 0.6, 74.5),
    quasi(t, 75) + 0.4 * quasi(t * 0.6, 76.5),
  ];
  const alongCenter =
    rawAxis[0] * center[0] + rawAxis[1] * center[1] + rawAxis[2] * center[2];
  const tangent: [number, number, number] = [
    rawAxis[0] - alongCenter * center[0],
    rawAxis[1] - alongCenter * center[1],
    rawAxis[2] - alongCenter * center[2],
  ];
  const axis = normalize3(tangent);

  return { center, axis };
}

// ═══════════════ Membrane Expression Sub-Phase 2: second fold reference ════
// Fold #2's own independently-evolving center/axis pair — same technique as
// getFoldReference (Fold #1) above, which is LOCKED and deliberately left
// untouched by this addition, not refactored into a shared parameterized
// helper, so Fold #1's exact trajectory cannot be perturbed even
// incidentally. Two things keep the two folds from synchronizing or
// chasing one another, per that requirement:
//   1. Entirely different quasi() seeds (131+ vs Fold #1's 61+) — different
//      phase offsets into the same incommensurate-sine field.
//   2. A different time-rate multiplier at the call site in JarvisCore3D
//      (0.05 for Fold #2 vs Fold #1's 0.06) — their relative phase keeps
//      drifting rather than locking into a fixed offset, since the two
//      rates are not a simple ratio of each other.
export function getFoldReference2(t: number): {
  center: [number, number, number];
  axis: [number, number, number];
} {
  const rawCenter: [number, number, number] = [
    quasi(t, 131) + 0.4 * quasi(t * 0.6, 132.5),
    quasi(t, 133) + 0.4 * quasi(t * 0.6, 134.5),
    quasi(t, 135) + 0.4 * quasi(t * 0.6, 136.5),
  ];
  const center = normalize3(rawCenter);

  const rawAxis: [number, number, number] = [
    quasi(t, 141) + 0.4 * quasi(t * 0.6, 142.5),
    quasi(t, 143) + 0.4 * quasi(t * 0.6, 144.5),
    quasi(t, 145) + 0.4 * quasi(t * 0.6, 146.5),
  ];
  const alongCenter =
    rawAxis[0] * center[0] + rawAxis[1] * center[1] + rawAxis[2] * center[2];
  const tangent: [number, number, number] = [
    rawAxis[0] - alongCenter * center[0],
    rawAxis[1] - alongCenter * center[1],
    rawAxis[2] - alongCenter * center[2],
  ];
  const axis = normalize3(tangent);

  return { center, axis };
}

// ═══════════════════════════ 2. CONTINUOUS IN-STATE MOTION ══════════════════
// Small ADDITIVE offsets layered on top of the tau-eased "live" values every
// frame — never written back into `live`, so they ride on top of the settle
// point rather than shifting it. Each state gets its own small, decorrelated
// (different seeds) combination; states not listed here get no continuous
// motion beyond what the shader's own noise-space drift always provides.
export function getContinuousMotion(state: JarvisState, t: number): PartialTween {
  switch (state) {
    case "idle":
      // Phase 8 Checkpoint D: "alive, available, calm, intelligent" now
      // comes from the shader's own per-layer drift (JarvisCore3D's
      // driftA/B/C — dominant field slowest, micro-detail fastest), NOT
      // from a global pulseStrength/displacementIntensity oscillation here.
      // Either of those two multiplies the WHOLE combined field uniformly —
      // however quasi-periodic the envelope, a single scalar breathing the
      // entire body in and out reads as exactly that: breathing/inflating.
      // Only a tiny rotational variation remains; the changing silhouette
      // itself (lobes strengthening/weakening/migrating as the drifting
      // noise field passes through them) is what now proves the Core is
      // alive, per the approved Checkpoint D direction.
      return {
        rotationSpeed: quasi(t, 1) * 0.015,
      };

    case "listening":
      // Deliberately the most restrained of all eight — must remain
      // perceptibly alive without undermining "I am being still for you."
      return {
        pulseStrength: quasi(t, 4) * 0.008,
      };

    case "thinking":
      // "Several regions of the same body processing simultaneously" —
      // sparse traveling pulses (not a constant elevated hum) plus a small
      // compression flutter. The actual spatial "travel" comes from the
      // existing Phase 1 shader noise-drift (unmodified); this is the
      // global scalar layer riding on top of it.
      return {
        pulseStrength: quasiPulse(t, 5) * 0.14,
        compressionAmount: quasi(t, 6) * 0.015,
      };

    case "researching":
      // "Information flowing through an active system" — gentle rotational
      // variation plus the evolution speed itself drifting a little, so the
      // noise field's own travel visibly speeds and eases.
      return {
        rotationSpeed: quasi(t, 7) * 0.015,
        timeScale: quasi(t, 8) * 0.08,
      };

    case "acting":
      // "Executing something" — punchier, less sparse than Thinking's
      // pulses, plus a touch of rotational energy variation.
      return {
        pulseStrength: quasiPulse(t, 9) * 0.22 + quasi(t, 9.5) * 0.05,
        rotationSpeed: quasi(t, 10) * 0.02,
      };

    case "speaking":
      // Small idle-ready life independent of amplitude; the real voice
      // response is getSpeakingModulation() below.
      return {
        pulseStrength: quasi(t, 11) * 0.015,
      };

    case "error":
      // "Reduced regularity, uneven pulse behavior, disturbed motion" —
      // asymmetric compression flutter, sharper pulse spikes, and a slight
      // rotational stutter. Distinct from Acting by being uneven/spiky
      // rather than smoothly energetic, and by riding on a contracted,
      // slowed-evolution base target rather than an expansive one.
      return {
        compressionAmount: quasi(t, 12) * 0.02 + quasiPulse(t, 13) * 0.045,
        pulseStrength: quasi(t, 14) * 0.1,
        rotationSpeed: quasi(t, 15) * 0.035,
      };

    case "complete":
    default:
      return {};
  }
}

// ═══════════════════════════ 3a. transient: COMPLETE ═════════════════════════
// A single rise-then-decay release pulse, shaped by elapsed time since
// Complete was entered — NOT a static target eased-to, an actual envelope.
// Coordinated with the controller's auto-return timer (COMPLETE_HOLD_MS,
// below): the release must be clearly perceptible before Idle reclaims the
// body. Peak at ATTACK (~0.25s), substantially decayed by ATTACK + DECAY
// (~1.25s), comfortably inside the ~1.6s hold.
const COMPLETE_ATTACK_S = 0.25;
const COMPLETE_DECAY_S = 1.0;
export const COMPLETE_HOLD_MS = 1600;

export function getCompleteEnvelope(elapsedS: number): PartialTween {
  const e =
    elapsedS < COMPLETE_ATTACK_S
      ? elapsedS / COMPLETE_ATTACK_S
      : Math.max(0, 1 - (elapsedS - COMPLETE_ATTACK_S) / COMPLETE_DECAY_S);
  return {
    pulseStrength: e * 0.35,
    radius: e * 0.06,
    displacementIntensity: e * 0.2,
  };
}

// ═══════════════════════════ 3b. transient: SPEAKING ═════════════════════════
// Speech amplitude (already smoothed by the renderer's own low-pass — see
// JarvisCore3D's liveAmplitudeRef) modulates the SAME body: no waveform
// geometry, no bars, no visualizer. Scales gracefully and monotonically
// across 0–1 so it reads as continuous resonance rather than discrete steps.
export function getSpeakingModulation(smoothedAmplitude: number): PartialTween {
  const a = Math.max(0, Math.min(1, smoothedAmplitude));
  return {
    pulseStrength: a * 0.35,
    displacementIntensity: a * 0.22,
    activityIntensity: a * 0.22,
    highlightStrength: a * 0.15,
    // Phase 5: speech amplitude also modulates the Checkpoint H cognitive-
    // energy dimensions — this was explicitly deferred through Phases 1-4
    // ("Speaking-specific speechAmplitude integration is NOT part of this
    // pass"). Same additive-on-top-of-resting-target mechanism as the four
    // fields above: jarvisState.ts's speaking profile is the quiet floor,
    // this is what voice adds on top of it, moment to moment. Kept modest —
    // energy should track the voice, not overwhelm the body.
    energyIntensity: a * 0.35,
    flowSpeed: a * 0.45,
    coherence: a * 0.25,
    // Small amber-leaning nudge while actively speaking — voice is JARVIS's
    // OUTPUT, distinct from Thinking/Researching/Acting's cyan-leaning
    // internal-computation read. Deliberately far short of Error's static
    // 0.35 target so Speaking never reads as "disrupted."
    warmEmphasis: a * 0.18,
    // A small directional nudge tracks louder moments as brief pushes of
    // more organized outward energy, without approaching Acting/Researching
    // levels — voice modulates the SAME resting body, not a separate
    // waveform visualizer.
    directionality: a * 0.2,
  };
}

// Time-constant for smoothing the RAW incoming speechAmplitude signal itself
// (distinct from TRANSITION_TAU, which eases the derived params). Faster
// than most state transitions — voice needs to feel responsive — but still a
// real low-pass so a jittery future audio-analyser signal doesn't jitter the
// body frame to frame.
export const SPEECH_AMPLITUDE_TAU = 0.12;
