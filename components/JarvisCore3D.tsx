"use client";

/**
 * JarvisCore3D — the permanent JARVIS particle body.
 *
 * Replaces the old ApexCore3D "particles" variant (random radial fill,
 * CPU-rewritten every frame — see ApexCore3D.jsx for the retired implementation,
 * kept on disk but off the render path). This is the geometric + visual
 * foundation the full 8-phase roadmap builds on:
 *
 *   - Deterministic Fibonacci-sphere distribution → every particle has a
 *     stable identity (its index) and a stable base direction forever. Later
 *     phases (agent affinity, speech-reactive regions, per-particle color
 *     masks) depend on that stability.
 *   - All displacement happens in the GPU vertex shader from two layered 3D
 *     simplex-noise fields sampled in object space and advanced by drifting
 *     the sample point through noise-space over time (NOT sin(time)) — so the
 *     deformation travels through the body and never visibly loops.
 *   - The CPU/React layer touches nothing per-frame except a small uniforms
 *     object (see `JarvisParams`) — that object is the whole control surface
 *     Phase 3/4's state engine will drive, and Phase 8's performance profiles
 *     will resize via `particleCount`.
 *
 * Phase 1 (geometry) established the body as a neutral diagnostic shape.
 * Phase 2 (this revision) adds the JARVIS visual identity on top of that
 * same geometry: an activity-driven indigo→violet→mauve→coral→peach color
 * ramp, front/rear depth shading, a restrained localized highlight, and
 * selective bloom. The deformation field (`vField`) that already drove
 * folds/valleys in Phase 1 now ALSO drives which particles read as "active" —
 * color is a second read of the same physical simulation, not a separate
 * system, so later state phases can shift activity (and therefore both shape
 * and color together) through one shared set of parameters.
 */
import React, { useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { JarvisState } from "./jarvis/jarvisState";
import {
  TWEENABLE_KEYS,
  getTau,
  getContinuousMotion,
  getCompleteEnvelope,
  getSpeakingModulation,
  getTiltWobble,
  SPEECH_AMPLITUDE_TAU,
  getFoldReference,
  getFoldReference2,
} from "./jarvis/motion";

// ───────────────────────── error boundary (ported from ApexCore3D) ─────────
// The decorative 3D body must never crash the app. WebGL context can be lost
// under GPU pressure; this catches any render error from the canvas subtree,
// hides the body, and retries a remount a few times (context often recovers).
class JarvisBoundary extends React.Component<
  { children: React.ReactNode },
  { dead: boolean }
> {
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { dead: false };
  }
  static getDerivedStateFromError() {
    return { dead: true };
  }
  componentDidCatch(err: unknown) {
    try {
      console.warn("[jarvis] core crashed — hiding:", (err as Error)?.message);
    } catch {}
    clearTimeout(this.timer);
    if (this.tries < 3) {
      this.tries += 1;
      this.timer = setTimeout(() => this.setState({ dead: false }), 8000);
    }
  }
  componentWillUnmount() {
    clearTimeout(this.timer);
  }
  render() {
    return this.state.dead ? null : this.props.children;
  }
}

// ───────────────────────── tunable parameters (the future control surface) ─
// This object is what Phase 3 (state engine) and Phase 4 (motion/transitions)
// will read/write every frame. Nothing here changes Phase 1's default look —
// values marked "reserved" are wired into the shader at neutral defaults so
// later phases don't need to touch the shader again, only these numbers.
export type JarvisParams = {
  radius: number; // base body radius
  freqA: number; // dominant lobe field: spatial frequency (low = fewer, broader lobes)
  ampA: number; // dominant lobe field: displacement amplitude
  driftA: [number, number, number]; // dominant lobe field: noise-space drift (direction × speed)
  lobeBiasExponent: number; // Phase 8 Checkpoint A: pow(abs(fieldA), this) — <1 pulls mid-magnitude noise toward its extremes, merging weak/borderline bumps into fewer, more decisively "in a lobe" regions. Fixed identity constant, never tweened per-state (same category as freqA/ampA).
  freqB: number; // subordinate asymmetry/crease field: spatial frequency — must stay clearly subordinate to A, never compete with it
  ampB: number; // subordinate asymmetry/crease field: displacement amplitude
  driftB: [number, number, number]; // subordinate field: noise-space drift
  freqC: number; // Phase 8 Checkpoint A: optional micro-detail field — spatial frequency (high). Only exists to keep the lobe surface from reading as mathematically sterile; amplitude must stay tiny enough that it is never independently legible as bumps/boiling.
  ampC: number; // micro-detail field: displacement amplitude (very low)
  driftC: [number, number, number]; // micro-detail field: noise-space drift
  timeScale: number; // global evolution-speed multiplier for all fields
  displacementIntensity: number; // master multiplier over total displacement
  compressionAmount: number; // inward pull on radius (0 = none) — Thinking-state hook
  pulseStrength: number; // multiplies both field amplitudes (0 = none) — pulse hook
  rotationSpeed: number; // group Y-rotation, rad/sec
  particleSize: number; // base sprite size before perspective attenuation
  opacity: number;

  // ── Phase 2: activity-driven color ──────────────────────────────────────
  // The indigo→violet→mauve→coral→peach ramp itself is a fixed 5-stop design
  // language (not exposed as uniforms — it's JARVIS's identity, not a dial).
  // What later phases DO control is how much of the body reaches into the
  // warm end, via the same `vField` deformation signal Phase 1 already
  // computes per particle:
  activityFieldLow: number; // vField value that maps to activity 0 (calm/cool)
  activityFieldHigh: number; // vField value that maps to activity 1 (hot/peach)
  activityBias: number; // pow() shaping exponent — higher = more of the body stays cool, only peaks turn warm
  activityIntensity: number; // additive global activity bias (0 = no effect) — the future per-state "how active right now" knob
  highlightColor: [number, number, number]; // localized near-white/peach highlight tone
  highlightStrength: number; // how strongly the highlight blends in on the hottest, most front-facing particles — "luminosity"

  // Phase 8 Checkpoint E: how much visible internal "neural" activity
  // (small coordinated pathways/impulses within the particle body) the
  // Core should show — independently controllable from activityIntensity
  // per the approved Phase 8 decision (activity level and visible neural
  // behavior are related but not the same concept). Tweenable through the
  // existing per-state transition system (see TWEENABLE_KEYS in motion.ts)
  // so it arrives smoothly alongside every other state-driven parameter.
  // NOT YET wired to any shader uniform — Checkpoint E only prepares this
  // as tweened state data; the actual neural visual effect is Checkpoint F.
  neuralActivity: number;

  // ── Checkpoint H motion-grammar pass: the cognitive-energy parameter
  // model, adapted from thinking-orbs motion-grammar study (not its
  // implementation). Tweenable through the existing TWEENABLE_KEYS/
  // TRANSITION_TAU system — no parallel animation architecture. Energy
  // remains a property traveling across the LOCKED membrane; none of these
  // touch displacement/geometry.
  energyIntensity: number; // 0..~1: participation of energyMask in the ramp (NOT a brightness multiplier — see rampEnergy)
  flowSpeed: number; // multiplies the time term inside energyMask only — never geometry/rotation time
  coherence: number; // scales broadGate/ridgeGate threshold width — >1 = tighter/organized, <1 = looser/diffuse
  warmEmphasis: number; // small additive bias on t (same mechanism as uActivityIntensity) — negative=cyan-leaning, positive=amber-leaning

  // ── Phase 4: cognitive directionality + controlled energy turbulence.
  // Both affect ONLY energyMask() (see fragment shader) — never geometry,
  // displacement, particleSize, camera, depth hierarchy, or material
  // opacity. At their neutral defaults (0, 0) both reduce to exactly the
  // Checkpoint H motion-grammar behavior — this is inert plumbing unless a
  // state target moves them.
  directionality: number; // 0..~1: biases energyMask's sample point along a slowly-wandering reference direction in OBJECT SPACE, giving energy a preferred travel direction across the membrane. 0 = isotropic (no bias).
  turbulence: number; // 0..~1(-2 bounded): perturbs energyMask's broad-gate threshold using its OWN already-sampled ridge field (no new noise sample) — higher = more fragmented/irregular energy organization, not physical jitter.
  // Stage 5, cyan-topology experiment: multiplies ONLY the cyan energyMask()
  // call's ridge-extraction half-width (see that function's own comment).
  // 1.0 is an exact no-op. Amber's call always passes 1.0 directly (not
  // wired to this param) and is therefore unaffected by any value here.
  cyanRidgeWidth: number;
  // Stage 5, 2nd cyan-topology experiment: soft floor applied to broadGate's
  // modulation of ridgeGate (see energyMask()'s own comment) — 0.0 is an
  // exact no-op (reduces to the original broadGate*ridgeGate hard AND).
  // Amber's call always passes 0.0 directly (not wired to this param) and
  // is therefore unaffected by any value here.
  cyanBroadFloor: number;
  // Stage 5, territory-selector experiment (diagnosis-only approval →
  // controlled experiment): threshold for a NEW, independent, very-low-
  // frequency noise field that gates how much of the sphere is eligible to
  // show ANY cyan ridge topology at all — separate from ridge character
  // (cyanRidgeWidth) and continuity/intensity (cyanBroadFloor). Default
  // -2.0 is an exact no-op: snoise() never produces a value that low, so
  // territoryGate evaluates to 1.0 (fully open/unrestricted) everywhere,
  // reproducing pre-territory behavior exactly. Amber's call always passes
  // -2.0 directly (not wired to this param) and is therefore unaffected by
  // any value here.
  cyanTerritoryThreshold: number;

  // ── Membrane Expression Sub-Phase 1: ONE deterministic coherent fold.
  // Unlike energyIntensity/flowSpeed/coherence/warmEmphasis/directionality/
  // turbulence above (all fragment-shader energy-only), this is a PHYSICAL
  // displacement amplitude — it feeds the vertex shader's `field` sum
  // alongside ampA/ampB/ampC (see foldField()), on top of and independent
  // from the locked Checkpoint G layers, never replacing or retuning them.
  ampFold: number; // 0 = no fold (default/inert). Raised only in small, visually-validated increments per this checkpoint's explicit instruction — no pre-authorized target value.

  // ── Membrane Expression Sub-Phase 2: a SECOND independent coherent fold,
  // same architecture/crease math as Fold #1 (foldField() is reused
  // verbatim — see the fragment/vertex shader), different global
  // center/axis reference (motion.ts's getFoldReference2), independently
  // controllable amplitude so dominance between the two folds is tunable.
  ampFold2: number; // 0 = no fold (default/inert). Independent from ampFold — "one dominant + one subordinate," not a shared knob.

  // ── Phase 2: depth shading ───────────────────────────────────────────────
  rearDarken: number; // brightness multiplier at dead-on rear (0 = black, 1 = no darkening)
  frontBoost: number; // brightness multiplier at dead-on front (1 = no boost)

  // ── Phase 2: bloom (postprocessing, not a shader uniform) ───────────────
  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomThreshold: number; // luminance threshold — only particles brighter than this bloom
  bloomSmoothing: number;
  bloomRadius: number;
};

// Phase 3/4: the interpolation boundary. `TWEENABLE_KEYS` and everything
// governing HOW those fields ease/move now live in components/jarvis/motion.ts
// (imported above) — the renderer only ever calls its functions, it doesn't
// author transition timing or motion itself. Everything else in JarvisParams
// (Phase 1 geometry, Phase 2 palette/depth/bloom) is never touched by a state
// profile, so it never needs smoothing: it just IS the locked value, always.

export const DEFAULT_PARAMS: JarvisParams = {
  radius: 0.8, // was 1.35 (interim 1.12, 0.92) — base+peak now clears the ring/label band instead of just the base sphere
  // Checkpoint G, 6th pass — the mono-diagnostic test (grayscale render,
  // color bypassed entirely) proved the 5th pass's geometry still reads as
  // a lumpy/cauliflower solid mass, not a hollow spherical shell: I had
  // REDISTRIBUTED total displacement amplitude across two co-equal broad
  // layers (A+B) but never actually REDUCED the total budget (~0.21, ~26%
  // of radius) — enough to distort the macro SILHOUETTE itself, not just
  // add surface texture. A hollow-shell read needs the overall outline to
  // stay close to a true sphere; irregularity has to live in FINE surface
  // ripple that doesn't reshape the silhouette. Total budget cut to ~0.10
  // (~13% of radius), redistributed so Layer C (fine ripple) carries
  // relatively more of the visual "life" than A/B (macro/mid shape).
  freqA: 0.75,
  ampA: 0.04,
  driftA: [0.045, 0.032, -0.026], // unchanged speed — still the slowest-evolving layer
  // Softened further 0.85→1.0 (no sharpening at all) — at this much lower
  // amplitude, decisive lobe-carving is neither needed nor wanted; Layer A
  // is now pure gentle asymmetry.
  lobeBiasExponent: 1.0,
  freqB: 2.6,
  ampB: 0.04,
  driftB: [-0.085, 0.14, 0.105], // unchanged speed — still faster than A, still slower than C
  freqC: 8.5,
  ampC: 0.022,
  driftC: [0.16, -0.13, 0.11], // unchanged — still fastest, still safe given amplitude stays well below A/B

  timeScale: 1.0,
  displacementIntensity: 1.0,
  compressionAmount: 0.0,
  pulseStrength: 0.0,
  rotationSpeed: 0.055,
  // Checkpoint G retune: particleSize 1.8→1.55, opacity 0.82→0.66 — smaller,
  // more translucent points widen the visible gaps between particles so the
  // body reads as thousands of distinct points with real negative space
  // between them, not a near-continuous dotted surface. Combined with the
  // darker ramp below, this is what makes individual particles legible
  // again instead of merging into a mesh-like skin.
  // Checkpoint G, 7th pass — root-cause fix (see chat for the full
  // derivation): at this camera distance/pixelRatio, the vertex shader's
  // point-size formula (`uParticleSize * uPixelRatio * 280/dist`) produced
  // ~114 BEFORE the clamp(1,40) even applied — meaning every particle
  // rendered at the 40px ceiling regardless of particleSize's actual value,
  // which is why prior "reduce particle size" passes (1.8→1.55→1.3) were
  // invisible in the render. 40px vs. the lattice's actual ~7px
  // nearest-neighbor spacing (18,000 points on r≈0.8) meant every sprite
  // overlapped 5+ neighbors — the direct cause of particles fusing into
  // continuous scalloped bands. Reduced to land comfortably under the
  // clamp (~4px average, ~1.5–6px with sizeJitter now actually visible
  // again) so individual particles read as separated points with real
  // negative space, matching Reference 2's fine particulate texture.
  particleSize: 0.045, // LOCKED at Checkpoint G — do not change
  // Checkpoint H, 1st pass: 0.52→0.82. The Checkpoint G 5th-pass color
  // system (and this opacity value) was tuned while particleSize was still
  // 1.3 — sprites overlapped 5+ neighbors, so even a middling per-particle
  // alpha built up to a solid-looking cumulative coverage. Now that
  // particles are correctly tiny and non-overlapping (locked geometry),
  // there is no overlap left to build up visual density — each particle's
  // OWN alpha has to carry the "is this point visible" read by itself. At
  // the old 0.52 the sphere nearly vanished against the dark background.
  // Checkpoint H, material-presence pass: 0.82→0.95. Diagnosed the actual
  // final alpha reaching front-facing dormant particles: edge(~1 at sprite
  // center) × vOpacityJitter(avg~0.86) × uOpacity(0.82) × vDepthOpacity
  // (~1.0 front) ≈ 0.70 — never truly opaque even at best case, which read
  // as "ethereal" regardless of RGB darkness. Raised close to (not
  // literally forced to) 1.0 so individual particles read as materially
  // solid; RGB darkness (below) now carries the "dormant/low-energy" read
  // instead of low alpha — alpha = presence, RGB = energy, kept separate.
  opacity: 0.95,

  // Field range at current ampA(0.18)+ampB(0.026) is roughly [-0.18, +0.18].
  // Tuning pass: raised/narrowed further — first-pass values let too much of
  // the field's positive (bulge) half read as active. Now only field values
  // ABOVE the calm/valley range contribute at all (negative field = pure
  // indigo, unconditionally), and it takes a genuine peak to approach 1.
  // Combined with the ramp's own non-uniform stops above, this is a second,
  // independent lever toward the same "mostly cool at rest" target.
  activityFieldLow: 0.06, // was -0.03 (interim 0.01) — first pass was still far too permissive
  activityFieldHigh: 0.22, // was 0.15 (interim 0.17)
  activityBias: 4.0, // was 2.4 (interim 2.8, 3.5) — final calibration nudge, paired with the widened ramp above
  activityIntensity: 0.0, // no global bias yet — Phase 3+ raises this per state
  neuralActivity: 0.0, // Phase 8 Checkpoint E: Idle baseline — effectively absent, per state profiles below
  // Checkpoint H motion-grammar: neutral identity defaults — chosen so that,
  // wired into energyMask/rampEnergy at these exact values, the math
  // reduces to EXACTLY the currently-approved Checkpoint H behavior (see
  // each wiring site's comment for the specific reduction). Per-state
  // profiles below are what actually differentiate cognitive conditions.
  energyIntensity: 1.0,
  flowSpeed: 1.0,
  coherence: 1.0,
  warmEmphasis: 0.0,
  // Phase 4: neutral identity defaults — 0 directionality (isotropic) and
  // 0 turbulence (no threshold perturbation) reduce energyMask() to EXACTLY
  // its pre-Phase-4 math. Per-state profiles are what actually differentiate
  // motion character.
  directionality: 0.0,
  turbulence: 0.0,
  // Stage 5, cyan-topology experiment — default 1.0 (exact no-op, matches
  // the prior hardcoded ridgeHalf constant). This is the value under active
  // A/B art-direction testing; do not change the default without explicit
  // project-owner approval of a specific candidate.
  cyanRidgeWidth: 1.0,
  // Stage 5, 2nd cyan-topology experiment — default 0.0 (exact no-op,
  // reduces to the original hard broadGate*ridgeGate AND). This is the
  // value under active A/B diagnostic testing; do not change the default
  // without explicit project-owner approval of a specific candidate.
  cyanBroadFloor: 0.0,
  // Stage 5, territory-selector experiment — default -2.0 (exact no-op, see
  // JarvisParams comment). This is the value under active A-D diagnostic
  // testing; do not change the default without explicit project-owner
  // approval of a specific candidate.
  cyanTerritoryThreshold: -2.0,
  // Membrane Expression Sub-Phase 1: true default is 0 (inert, no-op) per
  // explicit instruction — this checkpoint's own test uses a dev-only
  // override (window.__jarvisFoldAmp) rather than raising this default.
  ampFold: 0.0,
  ampFold2: 0.0,
  highlightColor: [0.97, 0.9, 0.84], // soft near-white peach, not pure white — NOTE: unused by the shader since Checkpoint B (see fragment shader comment); kept for prop-contract stability
  // Checkpoint G retune: 0.35 → 0.20 — this is one of several brightness
  // terms (nucleus, neural, rim, this highlight) that were stacking on top
  // of an already-bright base ramp. With the ramp itself now much darker,
  // a lower highlightStrength keeps the final near-white peak accent rare
  // rather than restoring the old washed-out coverage indirectly.
  highlightStrength: 0.2,

  // Checkpoint G retune: rearDarken 0.16→0.10 (more true darkness at the
  // rear — real negative space, not just "dim"), frontBoost 1.15→1.0
  // (removed — this was an artificial brightening multiplier stacking on
  // top of the ramp's own color; the new darker ramp shows its true color
  // on front-facing particles without needing an extra lift).
  rearDarken: 0.045, // Checkpoint G, 3rd pass: 0.1→0.045 — rear/internal particles now approach true near-black, per the reference's dark interior
  // Stage 4, production-luminosity pass — LOCKED, approved: 1.0→1.30.
  // Isolated A/B testing (holding every other variable identical) proved
  // frontBoost is the dominant lever for whole-Core visibility at true
  // dashboard scale — at 1.0 the front-facing majority of the visible
  // hemisphere (the surface that actually carries the "energized particle
  // membrane" read) got no boost at all over its raw, deliberately
  // dark-calibrated ramp color, so the Core read as barely-there at normal
  // viewing size. rearDarken, particleSize, bloomIntensity, and bloomRadius
  // were each tested in isolation and produced negligible-to-no change by
  // comparison — do not revisit those for this problem. Final value chosen
  // from a 5-candidate art-direction pass (1.18/1.22/1.26/1.30/1.34) judged
  // at true dashboard scale, not close-up: 1.18/1.22 stayed too visually
  // recessed for the Core's role as the dashboard's central object; 1.34
  // started giving too much visual weight to the broad blue membrane itself;
  // 1.30 was the chosen balance — enough presence to read the spherical
  // shell/surface structure/depth clearly without the whole Core reading as
  // uniformly bright. This is a LUMINOSITY/visibility value only — it does
  // NOT mean the Core's energy composition matches Reference 1; that is a
  // separate, still-open problem (see handoff doc).
  frontBoost: 1.3,

  bloomEnabled: true,
  // Checkpoint G retune — bloom judged visually against the reference, not
  // preserved numerically: intensity 0.55→0.4, threshold 0.55→0.78 (only
  // genuinely bright near-peak particles cross it now — the old threshold
  // was catching a much wider swath under the previous brighter ramp),
  // smoothing 0.25→0.18, radius 0.3→0.2 (tighter halos, so bloom creates
  // small accents around true peaks rather than fusing whole lobes into a
  // glow).
  // Checkpoint G, 2nd tuning pass: threshold raised further (0.78→0.87) —
  // CYAN_BRIGHT's own luminance (~0.81) was still crossing 0.78, letting
  // bloom spread across the whole base→bright transition rather than only
  // the rare extreme tier. Intensity/radius trimmed to match.
  // Checkpoint G, 4th pass: tightened further as a precaution against bloom
  // visually washing ELECTRIC_BLUE/CYAN_BASE particles upward — computed
  // luminances (ELECTRIC_BLUE ~0.28, CYAN_BASE ~0.61, CYAN_BRIGHT ~0.81) all
  // stay under this threshold now, so only CYAN_EXTREME/AMBER_EXTREME-tier
  // peaks (luminance ~0.91+) trigger bloom at all.
  // Colorspace boundary correction pass — threshold re-derived, not
  // preserved: 0.92→0.83. The fragment shader now emits genuinely linear
  // light (srgbToLinear() applied at each final gl_FragColor), whereas
  // 0.92 was calibrated against the OLD (incorrectly sRGB-authored-as-
  // linear) output. Re-measured what Bloom's luminance pass now actually
  // sees for the same anchors, decoding each channel through the identical
  // sRGB EOTF the shader uses, then computing luminance (NOT decoding the
  // old threshold scalar directly — that doesn't correspond to how a
  // per-channel decode interacts with the luminance weights):
  //   AMBER_EXTREME  new linear lum ≈ 0.891
  //   CYAN_EXTREME   new linear lum ≈ 0.819
  //   CYAN_BRIGHT    new linear lum ≈ 0.650
  // 0.83 sits just above CYAN_EXTREME/AMBER_EXTREME's own base luminance
  // (so only the highlight-boosted near-peak blend crosses it, same as
  // before) and well above CYAN_BRIGHT (so the ordinary bright-cyan tier
  // still never triggers bloom) — reproducing the exact same selectivity
  // ("only genuinely rare near-white peak events") in the corrected domain.
  bloomIntensity: 0.22,
  bloomThreshold: 0.83,
  bloomSmoothing: 0.14,
  bloomRadius: 0.12,
};

// ───────────────────────── deterministic Fibonacci sphere ──────────────────
// Golden-angle spiral: near-uniform area coverage, no lat/long banding, and
// particle i's direction is fixed forever — that stability IS the particle's
// identity for every later phase. Seed is a deterministic hash of the index
// (not Math.random) so the distribution is reproducible across reloads/SSR.
function buildFibonacciSphere(n: number) {
  const dir = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2; // 1 → -1
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    dir[i * 3] = Math.cos(theta) * radiusAtY;
    dir[i * 3 + 1] = y;
    dir[i * 3 + 2] = Math.sin(theta) * radiusAtY;
    // deterministic pseudo-random 0..1 from the index (hash, not RNG)
    const h = Math.sin(i * 12.9898) * 43758.5453;
    seed[i] = h - Math.floor(h);
  }
  return { dir, seed };
}

// Stage 4, distribution-artifact diagnostic (window.__jarvisRelaxedDist,
// TEMP A/B candidate — NOT wired in by default): the base
// buildFibonacciSphere() above places every particle at an EXACTLY regular
// golden-angle position and never perturbs it — the only existing
// per-particle variation (sizeJitter/vOpacityJitter, vertex shader) changes
// how a particle is DRAWN, never WHERE it sits, so the perfectly regular
// spiral spacing survives untouched underneath the render-time noise. That
// regularity was always there; restoring frontBoost's production-scale
// visibility just made it perceptible for the first time. This candidate
// applies a small, DETERMINISTIC, TANGENT-PLANE-ONLY offset to each
// particle's base direction before build (CPU-side, once, not per-frame —
// so particle identity/position is exactly as stable as the unperturbed
// version: no frame-to-frame crawl, no flicker), then renormalizes to put
// the point back on the unit sphere. Because the offset is constructed
// orthogonal to the particle's own normal, renormalizing pulls the point
// back to the shell with only a second-order (O(jitter^2), negligible at
// this magnitude) radial component — i.e. structurally almost pure
// angular/tangential perturbation, no meaningful radial randomness, exactly
// as required. Jitter magnitude is a fraction of the average nearest-
// neighbor spacing (~0.35×) — enough to break the spiral's visual
// regularity without opening gaps or clumping particles together.
function buildFibonacciSphereRelaxed(n: number) {
  const dir = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const avgSpacing = Math.sqrt((4 * Math.PI) / Math.max(1, n));
  const jitterAmp = avgSpacing * 0.35;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const nx = Math.cos(theta) * radiusAtY;
    const ny = y;
    const nz = Math.sin(theta) * radiusAtY;

    // Two independent deterministic hashes of i (different constants —
    // decorrelated, not derived from one another) drive jitter angle and
    // magnitude.
    const h1raw = Math.sin(i * 12.9898) * 43758.5453;
    const h1 = h1raw - Math.floor(h1raw);
    const h2raw = Math.sin(i * 78.233 + 4.7) * 12543.1234;
    const h2 = h2raw - Math.floor(h2raw);
    seed[i] = h1;

    // Orthonormal tangent basis at the particle's normal — cross with world
    // up, falling back to world-right at the poles where that's degenerate.
    let tx: number, ty: number, tz: number;
    if (Math.abs(ny) < 0.999) {
      // cross(normal, (0,1,0))
      tx = -nz; ty = 0; tz = nx;
    } else {
      // cross(normal, (1,0,0)) — only reached within ~2.5° of a pole
      tx = 0; ty = nz; tz = -ny;
    }
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;
    // second tangent = normal × tangent1 (already unit, both inputs unit+orthogonal)
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    const jitterAngle = h1 * Math.PI * 2;
    const jitterMag = h2 * jitterAmp;
    const ox = Math.cos(jitterAngle) * jitterMag;
    const oy = Math.sin(jitterAngle) * jitterMag;

    let px = nx + tx * ox + bx * oy;
    let py = ny + ty * ox + by * oy;
    let pz = nz + tz * ox + bz * oy;
    const pLen = Math.sqrt(px * px + py * py + pz * pz) || 1;
    px /= pLen; py /= pLen; pz /= pLen;

    dir[i * 3] = px;
    dir[i * 3 + 1] = py;
    dir[i * 3 + 2] = pz;
  }
  return { dir, seed };
}

// ───────────────────────── shaders ──────────────────────────────────────────
// Ashima Arts 3D simplex noise (webgl-noise, MIT) — the spatial noise field
// both deformation layers sample. Reused verbatim; this is the standard
// reference implementation, not something worth hand-rolling.
const SNOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
  + i.y+vec4(0.0,i1.y,i2.y,1.0))
  + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uFreqA;
uniform float uAmpA;
uniform vec3  uDriftA;
uniform float uLobeBias;
uniform float uFreqB;
uniform float uAmpB;
uniform vec3  uDriftB;
uniform float uFreqC;
uniform float uAmpC;
uniform vec3  uDriftC;
uniform float uDisplacementIntensity;
uniform float uCompressionAmount;
uniform float uPulseStrength;
uniform float uParticleSize;
uniform float uPixelRatio;

// Membrane Expression Sub-Phase 1 — ONE deterministic coherent fold.
// uFoldCenter/uFoldAxis are GLOBAL unit vectors (identical for every
// particle this frame), computed once per frame on the CPU — see
// motion.ts's getFoldReference(). Deliberately no noise sample this pass
// (see foldField() below): pure object-space vector math over the same
// fixed dir every other layer already uses.
uniform float uAmpFold;
uniform vec3  uFoldCenter;
uniform vec3  uFoldAxis;
// Membrane Expression Sub-Phase 2 — Fold #2. Same foldField() function
// (reused verbatim below), a second independent global center/axis pair.
uniform float uAmpFold2;
uniform vec3  uFoldCenter2;
uniform vec3  uFoldAxis2;
// Controlled organic irregularity — 0..1 gates for each of the three warp
// dimensions (trajectory/width/strength), staged independently per this
// sub-phase's validation requirement. At 0 each dimension is an exact
// no-op (see foldField() below); the warp SIGNALS themselves are the
// already-computed Layer A/B fields passed in per call site (see main()),
// never a new noise sample.
uniform float uWarpTraj;
uniform float uWarpWidth;
uniform float uWarpStrength;

attribute float aSeed;

varying float vFacing;
varying float vField;
varying float vFieldNormalized;
varying float vSeed;
varying float vOpacityJitter;
varying float vDepthOpacity;
varying vec3  vDir; // Phase 8 Checkpoint F: stable per-particle direction, passed through so the fragment shader can sample spatially-coherent noise (neural pathways) at this particle's actual position rather than only per-particle-random data.

${SNOISE_GLSL}

// Membrane Expression Sub-Phase 1 — the ONE coherent fold. Deterministic
// object-space vector math, no noise sample (deliberately, this pass — see
// the DEFAULT_PARAMS/uAmpFold comments). foldCenter/foldAxis are the SAME
// global pair for every particle (computed once per frame on the CPU), so
// every particle's fold contribution comes from evaluating the identical
// function against its own fixed dir — that shared reference is exactly
// what makes this ONE coherent structure rather than a per-particle effect.
// warpA/warpB: bounded reuse of the ALREADY-COMPUTED Layer A/B fields
// (never a new noise sample — see call sites in main()). warpTrajAmt/
// warpWidthAmt/warpStrengthAmt are 0..1 gates staged independently per the
// checkpoint's validation sequence; at 0 each is an exact no-op and the
// function reduces to precisely the locked Sub-Phase 1 crease math above.
float foldField(vec3 dir, vec3 foldCenter, vec3 foldAxis, float warpA, float warpB, float warpTrajAmt, float warpWidthAmt, float warpStrengthAmt) {
  // d: how close this particle's direction is to the fold's center, in
  // -1..1 (dot of two unit vectors = cosine of the angle between them).
  float d = dot(dir, foldCenter);
  // Broad, soft-edged influence region ("cap"). Below d=0.1 (particles more
  // than ~84° from foldCenter) the fold contributes NOTHING — that is the
  // "large calm/equilibrium region outside the fold" the checkpoint
  // requires. Full strength only begins past d=0.62 (~within ~51° of
  // foldCenter). Deliberately hardcoded constants for this first pass
  // (not yet exposed as a tweenable "sharpness" parameter, per the
  // "minimum plumbing for ONE fold" instruction).
  float cap = smoothstep(0.1, 0.62, d);
  // proj: position along the fold's grain. foldAxis is tangent to the
  // sphere at foldCenter (Gram-Schmidt–orthogonalized on the CPU side — see
  // getFoldReference), so within the cap this ranges close to its full
  // -1..1 span rather than being skewed toward one edge.
  float proj = dot(dir, foldAxis);
  // Sub-Phase 1, tuning pass — the visual problem with the first pass was
  // that the crease's frequency (3.4) matched the CAP's own broad width, so
  // ridge and valley each occupied roughly half the cap and read as two
  // separate smooth hills rather than one tight seam. Two independent
  // changes, addressing exactly that and nothing else:
  //   1. Frequency raised 3.4→5.4 — since ridge/valley sit at the sine's
  //      quarter-period points, a higher frequency pulls them PHYSICALLY
  //      CLOSER together (separation = pi/frequency, so this alone cuts
  //      their distance by ~35%) without touching cap/amplitude.
  //   2. A NEW, narrower envelope (independent from cap) confines the
  //      crease to a single cycle near proj=0 so the higher frequency does
  //      NOT introduce extra ripple cycles toward the cap's wider edges —
  //      without it, 5.4 rad across the full -1..1 range would produce a
  //      washboard of multiple ridges, which is not what was asked for.
  //      cap still governs the BROAD calm/connected-region boundary
  //      unchanged; this envelope only tightens the crease living inside it.

  // Controlled organic irregularity (Sub-Phase 2, irregularity pass) —
  // bounded warp on top of the LOCKED crease math above, never a
  // replacement for it. Each term defaults to an exact no-op at its gate=0:
  //   trajectory: proj shifts by at most ±0.10*cap before entering the
  //     crease — bends the crease's path smoothly rather than keeping it a
  //     perfectly straight geodesic. Gated by cap a SECOND time here (in
  //     addition to the final cap multiply below) so the trajectory bend
  //     itself is already zero outside the fold before it can do anything.
  //   width: widens/narrows the envelope by roughly ±35% — gradual tighten/
  //     relax along the crease's length, never an abrupt pinch (bounded,
  //     continuous multiplier, not a threshold).
  //   strength: varies local ridge/valley amplitude by roughly ±25%,
  //     clamped to [0.6, 1.3] so a section of the crease can never fully
  //     vanish (which would read as "crease fragmentation") or overshoot
  //     far past the base amplitude (which would read as a new bump).
  float projWarped = proj + warpA * 0.10 * warpTrajAmt * cap;
  float widthScale = 1.0 + warpB * 0.35 * warpWidthAmt;
  float creaseEnvelope = 1.0 - smoothstep(0.05, 0.78 * widthScale, abs(projWarped));
  float strengthScale = clamp(1.0 + warpB * 0.25 * warpStrengthAmt, 0.6, 1.3);
  float crease = sin(projWarped * 5.4) * creaseEnvelope * strengthScale;
  return crease * cap; // range approx [-1, 1]; uAmpFold scales it at the call site
}

void main() {
  vec3 dir = normalize(position); // Fibonacci base direction, stable per-particle identity

  // Checkpoint G, 5th pass — LOW/MID/HIGH hierarchy (retuned against
  // Reference 1; see the DEFAULT_PARAMS comment for the reasoning). Layer A
  // is no longer the sole silhouette driver — it now contributes gentle
  // macro asymmetry, with Layer B promoted to a genuine co-primary
  // contributor to the irregular surface contour, and Layer C raised to
  // visible (not just felt) fine ripple detail.

  // LOW — macro asymmetry/breathing. Same sign(x)*pow(abs(x),bias) sharpening
  // as before, but uLobeBias is now much closer to 1.0 (softened), so this
  // reads as gentle underlying asymmetry rather than decisive separate lobes.
  float fieldA_raw = snoise(dir * uFreqA + uDriftA * uTime);
  float fieldA = sign(fieldA_raw) * pow(abs(fieldA_raw), uLobeBias);

  // MID — primary irregular surface contour. Plain (unridged) snoise at
  // moderate frequency/amplitude — this is what now produces "several
  // irregular soft rises/valleys" without the old ridged-crease shape,
  // which was tuned for a subordinate accent role, not a co-primary one.
  float fieldB = snoise(dir * uFreqB + uDriftB * uTime + 31.7);

  // HIGH — fine ripple detail. Same technique as before, amplitude raised
  // so it's now visible surface texture rather than near-imperceptible.
  float fieldC = snoise(dir * uFreqC + uDriftC * uTime + 77.3);

  // Membrane Expression Sub-Phase 1: the ONE coherent fold's raw
  // contribution (range approx [-1,1]), scaled by uAmpFold exactly the way
  // fieldA/B/C are each scaled by their own amp — same accumulator, same
  // pulse/displacementIntensity multipliers (so Speaking's existing
  // amplitude-driven pulseStrength/displacementIntensity coupling scales
  // the fold proportionally too, without any special-case code or double
  // counting — see this checkpoint's Speaking-interaction requirement).
  // Decorrelation without a new noise sample: Fold #1 reads (fieldA_raw,
  // fieldB) directly; Fold #2 reads the SAME two fields with roles
  // swapped and one sign flipped (fieldB, -fieldA_raw). Both folds still
  // draw on the one shared membrane signal (per the requirement that the
  // material character stay shared), but because Layer A and Layer B are
  // different spatial fields (different frequency/drift) AND the sign
  // flip inverts warpB's effect, the two folds' trajectory/width/strength
  // responses are structurally independent — Fold #1 tightening where
  // fieldB is high does not imply Fold #2 does anything correlated there,
  // since Fold #2's own width/strength read from -fieldA_raw instead.
  float foldRaw = foldField(dir, uFoldCenter, uFoldAxis, fieldA_raw, fieldB, uWarpTraj, uWarpWidth, uWarpStrength);
  float foldRaw2 = foldField(dir, uFoldCenter2, uFoldAxis2, fieldB, -fieldA_raw, uWarpTraj, uWarpWidth, uWarpStrength);

  // Overlap bounding: when the two folds' caps happen to partially cover
  // the same particle, their scaled contributions are summed and then
  // hard-clamped to a fixed ceiling BEFORE entering the field accumulator.
  // This is a safety net independent of whatever ampFold/ampFold2 are
  // tuned to later — normal (non-overlapping) regions never approach it,
  // but it guarantees a rare simultaneous peak at an intersection cannot
  // produce a spike/protrusion beyond either fold's own amplitude alone.
  float foldCombined = foldRaw * uAmpFold + foldRaw2 * uAmpFold2;
  foldCombined = clamp(foldCombined, -0.16, 0.16);

  float pulse = 1.0 + uPulseStrength;
  float field = (fieldA * uAmpA + fieldB * uAmpB + fieldC * uAmpC + foldCombined) * pulse * uDisplacementIntensity;
  vField = field;

  // Phase 8 Checkpoint B: field normalized to roughly [-1, 1] using the
  // CURRENT achievable amplitude (amplitudes × pulse × displacementIntensity),
  // not a fixed constant — so the color ramp's thresholds stay meaningful
  // across every state's displacementIntensity/pulseStrength target instead
  // of drifting the way the old activityFieldLow/High thresholds would have
  // against a changing field range. uAmpFold is included here (not just in
  // the field sum above) so the fold participates in the SAME unified physical
  // displacement signal ampA/ampB/ampC already share — per this
  // checkpoint's explicit instruction that vFieldNormalized should
  // eventually let the existing color system reveal fold geometry, even
  // though color itself is out of scope for this validation pass.
  float maxFieldMag = (uAmpA + uAmpB + uAmpC + min(uAmpFold + uAmpFold2, 0.16)) * pulse * uDisplacementIntensity;
  vFieldNormalized = clamp(field / max(maxFieldMag, 0.0001), -1.0, 1.0);

  float r = uRadius - uCompressionAmount + field;
  vec3 displaced = dir * r;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);

  // Facing: the particle's own outward normal (≈ dir) transformed into view
  // space, compared to the camera's forward axis. +1 = dead-on front,
  // -1 = directly rear. Drives front/side/rear brightness falloff so
  // curvature and depth are genuinely readable, not faked with opacity.
  vec3 nrmView = normalize(mat3(modelViewMatrix) * dir);
  vFacing = dot(nrmView, vec3(0.0, 0.0, 1.0));

  vSeed = aSeed;
  vDir = dir;

  // Phase 8 Checkpoint C: depth-based size/opacity attenuation, on top of
  // (not replacing) the existing perspective attenuation and the
  // rearDarken/frontBoost brightness falloff below.
  // Checkpoint G, 8th pass (shell depth hierarchy): both ranges widened and
  // pow-curved (was a narrow linear mix) so near/front particles read
  // distinctly larger+more-opaque than side/rear ones — the same
  // camera-facing signal (facing01) already used for brightness, now also
  // driving size and alpha more assertively, per the "particle position →
  // depth-dependent radius + depth-dependent brightness" principle. Floors
  // stay well above zero (0.5 size, 0.3 alpha) so this reinforces depth
  // without creating an X-ray/ghost sphere.
  float facing01ForSize = clamp(vFacing * 0.5 + 0.5, 0.0, 1.0);
  float depthSizeFactor = mix(0.5, 1.2, pow(facing01ForSize, 1.5));
  // Checkpoint H, material-presence pass: floor raised 0.3→0.42 — rear
  // particles stay clearly subordinate (exponent/curve unchanged, so depth
  // ordering itself is untouched) but no longer approach ghost-like alpha;
  // "rear remains subordinate" is not the same as "rear becomes invisible."
  vDepthOpacity = mix(0.42, 1.0, pow(facing01ForSize, 1.6));

  gl_Position = projectionMatrix * mvPosition;
  float atten = uParticleSize * uPixelRatio * (280.0 / max(0.001, -mvPosition.z)) * depthSizeFactor;
  // Per-particle size + opacity jitter from the deterministic seed. The
  // golden-angle spiral is perfectly regular by construction; rendered at
  // uniform dot size/opacity it produces a visible moiré/spiral "fingerprint"
  // texture that is a display-sampling artifact, not deformation (confirmed
  // by zeroing both noise layers — the pattern persisted unchanged). Two
  // STATIC, deterministic, decorrelated per-particle multipliers — one on
  // size, one on opacity — break that regularity up without touching
  // position, identity, distribution, or the deformation fields at all.
  // seedB is a second hash of aSeed (not a new attribute) so the two
  // multipliers don't move together and reinforce the same banding.
  float seedB = fract(sin(aSeed * 91.345 + 12.9898) * 43758.5453);
  float sizeJitter = 0.4 + 1.2 * aSeed; // was 0.55 + 0.9·aSeed — wider spread to break the banding more decisively
  // Checkpoint H, material-presence pass: floor raised 0.72→0.88 — still
  // deterministic per-particle variance (still breaks the spiral moiré),
  // just a narrower dip so individual particles don't read as flickering
  // translucent on top of everything else contributing to alpha.
  vOpacityJitter = 0.88 + 0.12 * seedB;
  gl_PointSize = clamp(atten * sizeJitter, 1.0, 40.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

uniform float uOpacity;
// Dev-only diagnostic (window.__jarvisMonoDebug): when >0.5, bypasses the
// entire color/ramp/nucleus/neural/highlight system and outputs pure
// geometry+depth in grayscale — used to verify the Core reads as a hollow
// 3D particle shell (near surface / curved sides / dim far surface /
// negative space) independent of any color judgment. See main() below.
uniform float uMonoDebug;
// Color + Energy Mapping — Stage 1 diagnostic (window.__jarvisColorStage1):
// bypasses the ramp/nucleus/neural/highlight system entirely and outputs a
// single flat dark membrane tone (DEEP_BLUE) through the PRODUCTION depth
// treatment (uRearDarken/uFrontBoost/depthFactor, not uMonoDebug's separate
// diagnostic curve) — isolates "does the dark base + real depth system read
// on its own" from any energy/color-accent judgment. See main() below.
uniform float uColorStage1;
// Stage 2 diagnostic (window.__jarvisColorStage2): cool-energy-only —
// reuses the production ramp/rampEnergy/energyMask pipeline, restricted to
// the cyan/electric-blue/violet side with amber and near-white excluded.
// See main() below.
uniform float uColorStage2;
// Temporary calibration diagnostic (window.__jarvisEffDebug) — see main().
uniform float uEffDebug;
// Temporary pale-blue-source diagnostic (window.__jarvisFinalFrontDebug) —
// outputs the EXACT final Stage-2 fragment color (post coreColorRamp,
// post depthFactor, post rim) with alpha forced to 1.0 so a JS pixel
// readback gets the true per-particle linear-pipeline RGB with no
// antialiasing/blend ambiguity, restricted to front-facing particles only
// (facing01 > 0.5) via discard — not a permanent instrumentation path.
uniform float uFinalFrontDebug;
// Temporary colorspace proof-test diagnostic (window.__jarvisGrayTestValue):
// when >=0, forces EVERY particle to output a flat vec3(value) at alpha=1,
// bypassing every other system entirely — used to measure exactly what the
// production pipeline (including EffectComposer/Bloom) does to a KNOWN input
// value. Not a permanent instrumentation path — reverted after this pass.
uniform float uGrayTestValue;
// Verification-only companion (window.__jarvisGrayTestCorrected): when the
// gray-test diagnostic above is active, routes the known input through the
// srgbToLinear() correction first — used specifically to re-verify the
// colorspace fix end-to-end. Independent of the correction applied to the
// real production/Stage1/Stage2 paths.
uniform float uGrayTestCorrected;
// Stage 3 diagnostic (window.__jarvisAmberEffDebug): outputs the raw eff
// value (same rampEnergy() output the amber coreColorRamp branch consumes)
// as solid grayscale, restricted to amber-side particles (t<0) via discard
// — measures the amber-side eff distribution in isolation, same technique
// as the earlier cyan-side uEffDebug calibration. Not a permanent
// instrumentation path.
uniform float uAmberEffDebug;
// Stage 3 diagnostic (window.__jarvisTMagDebug): outputs abs(t) directly
// (not eff) for amber-side (t<0) particles only — isolates whether a low
// amber eff population is caused by the displacement field rarely going
// negative enough, vs. the energyAmber mask itself being inactive.
uniform float uTMagDebug;
// Stage 3 spatial-coherence diagnostic (window.__jarvisAmberMaskDebug):
// outputs energyAmber (the raw energyMask() gate, BEFORE the |t|-dependent
// shapedA multiply in rampEnergy) directly, amber-side only — isolates
// whether the mask itself forms coherent connected regions, independent of
// whatever fragmentation the displacement-magnitude gating might add.
uniform float uAmberMaskDebug;
// Stage 5, cyan-topology experiment: ridge-width multiplier applied ONLY to
// the cyan energyMask() call (see that function's own comment). 1.0 is an
// exact no-op matching the previously-hardcoded constant.
uniform float uCyanRidgeWidth;
// Stage 5, 2nd cyan-topology experiment: soft floor applied to broadGate's
// modulation of ridgeGate (see energyMask()'s own comment). 0.0 is an exact
// no-op matching the original hard-AND formula.
uniform float uCyanBroadFloor;
// Stage 5, territory-selector experiment: threshold for the new low-
// frequency territory-selector field applied ONLY to the cyan energyMask()
// call (see that function's own comment). -2.0 is an exact no-op.
uniform float uCyanTerritoryThreshold;
// Stage 5 diagnostic (window.__jarvisCyanMaskDebug): mirrors
// uAmberMaskDebug for the cyan side.
uniform float uCyanMaskDebug;
// Stage 5, territory-selector experiment diagnostic
// (window.__jarvisCyanTerritoryDebug): outputs the raw territoryGate value
// (post-threshold, pre-ridge/broad) directly as grayscale, cyan-side only —
// isolates the territory selector's own eligible-area coverage independent
// of ridge/broad structure.
uniform float uCyanTerritoryDebug;

// Legacy activity-mapping uniforms (Phase 2). No longer read by the
// Checkpoint B color ramp below — the new ramp is driven directly by
// vFieldNormalized instead of a remapped/biased "activity" scalar. Left
// declared/assigned (see the JS uniforms object and the frame loop) to keep
// this diff scoped to the color field only; a future cleanup pass may retire
// them once the nucleus/neural checkpoints confirm nothing else needs them.
uniform float uActivityFieldLow;
uniform float uActivityFieldHigh;
uniform float uActivityBias;
uniform float uActivityIntensity;
uniform vec3  uHighlightColor;
uniform float uHighlightStrength;

// Depth shading
uniform float uRearDarken;
uniform float uFrontBoost;

// Phase 8 Checkpoint F: master gate/intensity for internal neural activity.
// 0 (or near-0) must be cheap — the branch in main() below skips the neural
// noise samples entirely when this is negligible (Idle/Listening/Error/
// settled-Complete), per the Phase 8 performance strategy.
uniform float uNeuralActivity;
uniform highp float uTime; // matches the vertex shader's default (highp) precision for uTime — a mediump/highp mismatch on the same uniform name fails shader linking

// Checkpoint H motion-grammar — the cognitive-energy parameter model.
// Consumed only by energyMask()/rampEnergy()/coreColorRamp() below; never
// touches displacement/geometry (see JarvisParams comment for the full
// architecture note). At the neutral defaults (1.0, 1.0, 1.0, 0.0) every
// wiring site below reduces to exactly its pre-Checkpoint-H behavior.
uniform float uEnergyIntensity; // participation of energyMask in the ramp
uniform float uFlowSpeed;       // multiplies energyMask's time term only
uniform float uCoherence;       // scales broadGate/ridgeGate threshold width
uniform float uWarmEmphasis;    // small additive bias on t (cyan↔amber)

// Phase 4 — cognitive directionality + controlled energy turbulence. Both
// consumed only inside energyMask() below; at (0, 0) energyMask() reduces to
// exactly its pre-Phase-4 form (see energyMask's own comments).
uniform float uDirectionality; // biases energy sampling along a wandering object-space reference direction
uniform float uTurbulence;     // perturbs the broad-gate threshold using energyMask's OWN ridge sample

varying float vFacing;
varying float vField;
varying float vFieldNormalized;
varying float vSeed;
varying float vOpacityJitter;
varying float vDepthOpacity;
varying vec3  vDir;

${SNOISE_GLSL}

// Cyan↔amber identity palette. Checkpoint B's four bright anchors (base/
// bright/extreme on each side) are UNCHANGED hex values from the approved
// brief — Checkpoint G does not alter the displacement→color RELATIONSHIP,
// only how much of the particle population reaches each anchor (see the
// gamma-shaped ramp below). Two new DEEP anchors added this checkpoint are
// what the majority of the body now actually renders as: dark electric-
// blue/indigo and dark amber/rust, not the old CYAN_BASE/AMBER_BASE tones,
// which were themselves already fairly bright and are now reserved for
// genuinely elevated displacement, not the whole exterior.
const vec3 AMBER_EXTREME = vec3(1.0000, 0.9490, 0.8000); // #fff2cc
const vec3 AMBER_INTENSE = vec3(1.0000, 0.7216, 0.3020); // #ffb84d
const vec3 AMBER_BASE    = vec3(1.0000, 0.5608, 0.1216); // #ff8f1f
const vec3 CYAN_BASE     = vec3(0.1608, 0.7137, 0.9647); // #29b6f6
const vec3 CYAN_BRIGHT   = vec3(0.4980, 0.8784, 1.0000); // #7fe0ff
const vec3 CYAN_EXTREME  = vec3(0.8039, 0.9373, 1.0000); // #cdefff
// Checkpoint H, 1st pass brightened these (each was near-invisible at low
// alpha). Checkpoint H material-presence pass: darkened again, in the
// OPPOSITE direction — now that alpha (above) carries the "is this particle
// materially present" job at ~0.95, RGB is free to go back to genuinely
// dark/low-luminance without the particle disappearing. This is the
// ALPHA=presence / RGB=luminance separation: darker RGB no longer means
// fainter particle, it means a materially-solid but low-energy one.
const vec3 DEEP_BLUE  = vec3(0.0260, 0.0520, 0.1150); // dark navy — majority-population dark anchor
const vec3 DEEP_AMBER = vec3(0.0620, 0.0320, 0.0140); // dark rust
// Checkpoint G, 4th tuning pass — root-cause fix. Reference-image inspection
// showed the problem wasn't the input distribution (gamma-shaping alone):
// Checkpoint A's lobes are, BY DESIGN, broad regions of consistently
// elevated field (that's what makes them read as lobes), so even a
// strongly-shaped input still lands at a moderately-high shaped value
// across most of a lobe's surface — not just at its crest. A 2-anchor
// dark→CYAN_BASE mix couldn't express "elevated but still not truly cyan"
// as its own visual state. ELECTRIC_BLUE is that missing middle rung: a
// saturated but distinctly BLUE (not cyan-hued) tone that now absorbs most
// of a lobe's body, leaving CYAN_BASE/BRIGHT/EXTREME for only the true
// energetic crest.
// Stage 2 palette/luminance pass — darkened substantially from the original
// (0.118, 0.275, 0.745). The mid-energy tier was reading as pale/pastel
// blue because this anchor's own LUMINANCE was already ~5x the dormant
// DEEP_BLUE floor. Saturation is unchanged (still a strongly blue-dominant
// ratio, not diluted toward white) — only overall brightness dropped, so
// "brighter than dormant" now means visibly-but-not-pastel deep saturated
// blue, per "controlled luminance + saturation, not mixing toward white."
const vec3 ELECTRIC_BLUE = vec3(0.0500, 0.1200, 0.4000); // deep saturated mid-tier blue — distinctly blue, not cyan, not pastel
const vec3 VIOLET        = vec3(0.3760, 0.2900, 0.7600); // restrained violet/purple transition accent

// Checkpoint G, 5th pass — the core fix for "energy topology" (displacement
// magnitude alone was painting entire raised regions, since a broad lobe is
// BY CONSTRUCTION a region of uniformly-elevated displacement). This
// independent, slowly-drifting noise field — sampled at the same vDir used
// by Checkpoint F's neural layer, at its own frequency/drift, NOT derived
// from fields A/B/C — decides WHERE illumination is currently visible,
// decoupled from WHERE the surface happens to be raised. A particle can sit
// on a raised lobe and still render dark if this field isn't active there;
// as the field drifts, the illuminated ridges migrate through the raised
// geometry over time — "energy traveling through the Core," not the Core's
// surface simply being colored by its own shape. Two decorrelated instances
// (cyan/amber use different phase offsets) so illuminated cyan ridges and
// amber concentrations don't spatially coincide.
// Checkpoint H, 2nd pass: rebuilt as a TWO-SCALE coherent field (was one
// mid-frequency sample thresholded fairly permissively, which let energy
// spread across too much of the sphere as soft blobs). A broad, slow
// low-frequency field now gates WHERE activity is allowed to exist at all;
// a faster, higher-frequency field then carves thin ridge/vein structure
// WITHIN that broad zone. Multiplying the two (an "AND" of both gates)
// naturally produces thin, organic, intersecting structures rather than
// one soft-edged blob — particles belonging to the same broad region can
// share the same flowing ridge instead of activating independently.
// Checkpoint H motion-grammar pass: coherence scales the WIDTH of both
// gate thresholds around their existing (unchanged) centers — same two
// noise samples, no new fields. At coherence=1.0 this reduces to EXACTLY
// the prior fixed thresholds (0.38–0.70 / 0.72–0.92). coherence>1 narrows
// the band (sharper, more "organized/intelligible" structure); coherence<1
// widens it (softer, more diffuse). Clamped so it can never invert or
// degenerate.
// Phase 4A/4B — directionality and turbulence, both folded into this SAME
// function, using the SAME two noise samples (broad/ridge) already sampled
// here. No new noise call is added by either.
//
// DIRECTIONALITY: instead of representing "a preferred travel direction" as
// a literal scanning graphic, the sample POINT itself is advected along a
// slowly-wandering object-space reference direction (dirRef, computed once
// per-fragment in main() from incommensurate sine waves — no new noise
// sample) before either noise field is evaluated. This is the exact same
// "offset the sample coordinate over time" technique already used by the
// physical drift layers (driftA/B/C in the vertex shader) and by this
// function's own existing per-phase time term — just applied along a chosen
// direction instead of a fixed per-layer constant. Because dirRef is a full
// 3D unit vector and the sample coordinate lives in the same 3D object space
// as dir, the resulting bias travels naturally across front/side/rear —
// it is geometry-space advection, never a screen-space overlay. At
// directionality=0 the sample point is unchanged (dir), so this is an exact
// no-op.
//
// TURBULENCE: perturbs the broad gate's threshold CENTER using the ridge
// field's own already-computed value (reused, not resampled) as a spatial
// wobble. Because the ridge field is itself high-frequency, this makes the
// broad gate's edge fray into fragmented, less-coherent shapes rather than
// a clean boundary — "energy behavior becomes less coherent and more
// fragmented," without touching displacement. At turbulence=0 this is an
// exact no-op (wobble=0).
// Stage 5, cyan-topology experiment — LOCKED-SAFE parameterization: added
// ridgeWidthMult (default/amber-call value 1.0, an EXACT no-op reducing to
// the prior hardcoded 0.10 constant) so the CYAN call site alone can widen
// its ridge-extraction band without touching amber's call, which continues
// passing 1.0 explicitly and is therefore byte-for-byte equivalent to the
// locked, verified Stage 3 baseline — broadGate, coherence handling, and
// every other term are unchanged for both callers.
//
// Stage 5, 2nd experiment — continuity/topology diagnostic, LOCKED-SAFE
// parameterization: added broadSoftFloor (default/amber-call value 0.0, an
// EXACT no-op — mix(0.0, 1.0, broadGate) === broadGate, so the return
// expression reduces to the original broadGate*ridgeGate hard-AND at 0.0).
// Diagnosis (see conversation record): ridgeGate already contains the
// useful continuous winding topology (zero-crossing extraction of a 4.2x
// frequency field genuinely forms long connected curves); broadGate is an
// independent, uncorrelated, coarser field (1.3x frequency, separate phase)
// that — when hard-multiplied against ridgeGate — severs the ridge curve
// wherever it crosses a broadGate boundary, producing the isolated-fragment
// appearance rather than a topology problem in ridgeGate itself. This
// parameter lets the CYAN call soften that hard clip: broadGate still
// modulates intensity/how "activated" a region reads, but no longer
// hard-zeros ridge topology outside its own boundaries — testing whether
// this turns severed fragments into longer connected pathways. Amber's call
// continues passing 0.0 explicitly (never reads this parameter) and is
// therefore unaffected regardless of what value cyan is tested at.
// Stage 5, territory-selector experiment: isolated as its own function (not
// inlined in energyMask) so main()'s debug branch can call the EXACT same
// math for the raw-territory diagnostic capture without duplicating it.
float cyanTerritoryGate(vec3 dir, float time, float phase, float directionality, vec3 dirRef, float territoryThreshold) {
  float dTrav = time * 0.11 * clamp(directionality, 0.0, 1.0);
  vec3 sampleDir = dir + dirRef * dTrav * 0.4;
  float territory = snoise(sampleDir * 0.4 + vec3(0.02, 0.017, -0.014) * time * 0.15 + phase * 1.31 + 23.0);
  float territoryHalf = 0.12;
  return smoothstep(territoryThreshold - territoryHalf, territoryThreshold + territoryHalf, territory);
}

float energyMask(vec3 dir, float time, float phase, float coherence, float directionality, float turbulence, vec3 dirRef, float ridgeWidthMult, float broadSoftFloor, float territoryThreshold) {
  float cw = clamp(coherence, 0.4, 2.2);

  float dTrav = time * 0.11 * clamp(directionality, 0.0, 1.0);
  vec3 sampleDir = dir + dirRef * dTrav * 0.4;

  float broad = snoise(sampleDir * 1.3 + vec3(0.05, -0.04, 0.035) * time * 0.22 + phase);
  float ridge = snoise(sampleDir * 4.2 + vec3(0.09, -0.07, 0.06) * time * 0.5 + phase + 11.0);
  // Ridge extraction (unchanged technique — see prior pass's comment):
  // 1-|x| peaks only at the noise field's zero-crossings, forming thin
  // winding curves rather than blobby regions.
  float ridged = 1.0 - abs(ridge);

  float tb = clamp(turbulence, 0.0, 2.0);
  float wobble = ridge * 0.14 * tb;

  float broadHalf = 0.16 / cw;
  float broadGate = smoothstep(0.54 - broadHalf + wobble, 0.54 + broadHalf + wobble, broad);
  float ridgeHalf = (0.10 * ridgeWidthMult) / cw;
  float ridgeGate = smoothstep(0.82 - ridgeHalf, 0.82 + ridgeHalf, ridged);

  // Stage 5, territory-selector experiment: a THIRD, independent, very-low-
  // frequency noise field (own frequency/phase/drift — decorrelated from
  // both broad and ridge, not derived from either) that gates whether this
  // fragment's location is inside an "eligible" territory at all, before any
  // ridge/broad structure is considered. At territoryThreshold <= -2.0
  // (default), territoryGate saturates to 1.0 everywhere — exact no-op.
  float territoryGateVal = cyanTerritoryGate(dir, time, phase, directionality, dirRef, territoryThreshold);

  return territoryGateVal * ridgeGate * mix(broadSoftFloor, 1.0, broadGate);
}

// Colorspace boundary correction — proof-tested pass. All of this shader's
// color anchors (DEEP_BLUE, ELECTRIC_BLUE, CYAN_BASE, AMBER_*, etc.) were
// authored as final DISPLAY/sRGB values, but EffectComposer's EffectPass
// (the <Bloom> wrapper's single composite pass — confirmed via node_modules
// source: EffectMaterial's ENCODE_OUTPUT define is unconditional) treats
// the scene it captures as LINEAR light and applies exactly one
// linear→sRGB encode on final output, since renderer.outputColorSpace is
// "srgb" (deterministic 6-point proof test: input 0.05 → measured 0.248,
// matching predicted sRGB-encode(0.05)=0.2477; composer-disabled control
// measured 0.051, i.e. unencoded passthrough — confirms a SINGLE encode
// applied only by the composer, not a renderer-level double-encode). This
// function is the exact inverse of three.js's own encode (sRGBTransferOETF
// in colorspace_pars_fragment.glsl.js) — not an approximate gamma curve —
// so the round-trip through this function + the composer's existing encode
// reproduces the authored value exactly. Applied ONLY at each branch's
// final gl_FragColor assignment (production color, Stage 1, Stage 2) —
// never inside uMonoDebug/uEffDebug/uGrayTestValue/uFinalFrontDebug's own
// synthetic-value branches, which intentionally stay raw for pipeline
// measurement.
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c * 0.0773993808;
  vec3 hi = pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4));
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
}

// Combines raw displacement (shaped by a per-side gamma) with the energy
// mask into a single 0..1 "how illuminated is this particle right now"
// value. Kept separate from coreColorRamp so main() can reuse the exact
// same value for the final highlight pass (Checkpoint G point 7: highlight
// and color must agree on what "extreme" means).
float rampEnergy(float t, float energyCyan, float energyAmber) {
  const float band = 0.08;
  float absT = abs(t);
  if (absT <= band) return 0.0;
  float u = clamp((absT - band) / (1.0 - band), 0.0, 1.0);
  if (t > 0.0) {
    // Stage 2 distribution-correction pass — LOCKED, approved: 3.0→1.9.
    // Diagnostic evidence (pixel-readback of raw eff) showed the population
    // was bimodal — almost every off-mask particle capped near the 0.03
    // floor (unchanged by this, see below) while on-mask particles
    // clustered at already-high shaped values, skipping the intended
    // 0.03-0.09 transition band almost entirely. Lowering the exponent only
    // redistributes how MUCH of a given particle's own |t| maps into
    // shaped — it does not touch energyCyan's spatial gate (energyMask
    // topology untouched), so which particles participate at all is
    // unchanged; only how brightly the already-participating (and off-mask
    // floor) particles land within the eff range changes. Measured result:
    // <0.03=78.3%, 0.03-0.055=12.5%, 0.055-0.09=5.8%, 0.09-0.16=2.8%,
    // >0.16=0.65% — no longer bimodal, continuous hierarchy. Do not modify
    // again unless explicitly reopened.
    const float GAMMA_CYAN = 1.9;
    float shaped = pow(u, GAMMA_CYAN);
    // Floor unchanged (0.03) — off-mask particles (energyCyan≈0) still
    // reduce to shaped*0.03, and since shaped≤1 always, this term alone can
    // never exceed exactly 0.03. That means the <0.03 "dark membrane"
    // population's ceiling is structurally unaffected by the gamma change
    // above: it is governed entirely by energyCyan's own (untouched)
    // spatial mask, not by this curve.
    return shaped * mix(0.03, 1.0, energyCyan);
  }
  // Stage 3 amber calibration pass: 3.8→2.2. Kept deliberately steeper than
  // cyan's 1.9 (amber must read as MORE subordinate/rare than cyan per this
  // stage's spec) while still letting genuine high-|t| valley particles
  // register a nonzero shapedA at all — at 3.8 essentially the entire
  // population rounded to 0 (see coreColorRamp's amber-branch comment for
  // the measured evidence). The energyAmber mask (its own spatial gate,
  // untouched) still governs WHERE amber can ever appear; this only affects
  // how strongly a mask-active valley particle's displacement contributes.
  const float GAMMA_AMBER = 2.2;
  float shapedA = pow(u, GAMMA_AMBER);
  // Stage 3 topology diagnostic (same-frame synchronized capture: raw
  // energyAmber mask vs. eff, isolating particles where energyAmber<=0.05 —
  // i.e. clearly OFF the coherent ridge — that nonetheless crossed the first
  // visible amber threshold, eff>=0.01): with the previous 0.025 floor, 81%
  // of all visible-amber pixels in the sampled frame were this off-ridge
  // leak (11370 of 14036 px), vs. only 1673 px genuinely on-ridge
  // (energyAmber>0.3). Root cause: mix(floor, 1.0, energyAmber) is LINEAR,
  // so even a small/edge-noise energyAmber value (0.05-0.2) already pushes
  // the floor most of the way toward 1.0 — meaning raw |t| alone, largely
  // uncorrelated with energyAmber's ridge shape, was deciding WHERE most
  // visible amber appeared, backwards from the intended hierarchy
  // (energyAmber=WHERE, displacement=HOW STRONGLY). A first attempt (linear
  // mix, floor merely lowered 0.025→0.008) cut total leak but a re-measure
  // with a stricter off-ridge definition (energyAmber<=0.02) still showed
  // leak surviving via the same linear-slope mechanism at slightly higher
  // energyAmber. Fix: gate the floor's ramp with pow(energyAmber, 3.0)
  // instead of a linear mix, so the floor stays near its minimum until
  // energyAmber is genuinely substantial (ridge core), then rises — same
  // technique as GAMMA_CYAN/GAMMA_AMBER shaping u, applied to the mask
  // instead of displacement. Verified on the same captured frame: floor
  // 0.006 + power 3.0 reduces genuinely-off-ridge leak to 0 px (was 3772 at
  // floor=0.025) and edge-zone leak to 80 px (was 2193), while on-ridge
  // visible coverage stays at 1549 of that frame's 2419 baseline (64%) — a
  // real reduction in amber quantity (expected and desired per spec: "may
  // disappear almost entirely at some moments") but now 95% of what remains
  // visible is genuine ridge signal (1549/1629) instead of 29% (2419/8384).
  float ridgeGateA = pow(clamp(energyAmber, 0.0, 1.0), 3.0);
  float dispModulated = shapedA * mix(0.006, 1.0, ridgeGateA);
  // Stage 3, 2nd correction pass: re-verifying against real production
  // captures (four honest unboosted frames, ~26s of continuous run) showed
  // the topology fix above was too conservative — amber almost never
  // crossed the first visibility threshold (0.01) at all. Diagnosed why by
  // reconstructing shapedA from a same-instant captured frame and testing
  // "raise the floor" candidates offline first: raising 0.006 does NOT
  // help, because at ridgeGateA≈1 (deep in a strong ridge) mix() already
  // returns ≈1 regardless of the floor's value — the floor constant only
  // ever affects LOW-ridgeGateA (edge/off-ridge) particles, i.e. raising it
  // just reintroduces the leak this pass exists to remove, while doing
  // nothing for genuine ridge-core particles whose own |t| happens to be
  // weak (measured: on that captured frame, on-ridge shapedA median was
  // exactly 0.0 — median ridge particle has almost no displacement of its
  // own). The actual bottleneck is that shapedA and energyAmber are
  // independent fields, so a strong ridge can coincide with weak local
  // displacement and never light up under a purely multiplicative formula,
  // no matter how the floor constant is tuned.
  // Fix: a SEPARATE, additive, ridge-gated minimum — RIDGE_MIN * ridgeGateA
  // — using the SAME pow(energyAmber,3) gate (so it inherits the identical
  // off-ridge protection: gate≈0 off-ridge means this term is also ≈0
  // there, structurally unable to leak) but independent of shapedA. This
  // guarantees the STRONGEST ridge particles (ridgeGateA near 1) reach a
  // baseline eff regardless of their own displacement, while weaker ridge
  // regions (ridgeGateA<1) get proportionally less — so only the ridge's
  // own strongest moments become legible, not the whole structure
  // uniformly. Combined with dispModulated via max(): displacement can
  // still push a particle brighter than this baseline (the "occasional
  // tiny hotter point" requirement) but can no longer suppress a strong
  // ridge to invisible. Topology-gate architecture (pow(energyAmber,3) on
  // both terms) is LOCKED/approved — this constant is the only thing this
  // pass may touch.
  //
  // 2nd calibration pass: 0.03→0.045. At normal (uncropped, unboosted)
  // dashboard scale, 45-60s of honest production captures showed the
  // topology fix produced correct temporal behavior (amber genuinely
  // absent, faint, or an occasional connected arc) but the strongest event
  // was still extremely subtle — a fully-saturated ridge (energyAmber=1,
  // ridgeGateA=1) only reached eff=RIDGE_MIN=0.03, just past the
  // 0.025 DEEP_AMBER→AMBER_BASE boundary. Raising to 0.045 pushes a
  // fully-saturated ridge about 40% further into the 0.025-0.06
  // AMBER_BASE→AMBER_INTENSE tier without reaching AMBER_EXTREME — a small,
  // amplitude-only change; the topology gate shape (pow(...,3)) and both
  // off-ridge floors (0.006 on dispModulated) are untouched, so leak
  // immunity is unaffected (off-ridge ridgeGateA≈0 regardless of this
  // constant's value).
  const float RIDGE_MIN = 0.045;
  return max(dispModulated, RIDGE_MIN * ridgeGateA);
}

// Phase 8 Checkpoint G — the displacement-driven ramp. The RELATIONSHIP
// (positive=cyan/exterior, negative=amber/interior) and the narrow
// zero-crossing seam are both unchanged from Checkpoint B; eff (from
// rampEnergy above) replaces raw displacement as the tier-selection input.
vec3 coreColorRamp(float t, float seed, float eff) {
  t = clamp(t, -1.0, 1.0);
  const float band = 0.08;
  float absT = abs(t);
  if (absT <= band) {
    // Dark neutral seam: mix the two DEEP anchors so near-zero-displacement
    // particles — the largest single group under a noise field — read as
    // genuine dark negative space, not a bright seam between two hues.
    float m = (t + band) / (2.0 * band);
    vec3 seam = mix(DEEP_AMBER, DEEP_BLUE, m);
    return seam * 0.6;
  }

  // Checkpoint H, final pass: flat-dark zone widened further (0.32→0.44) and
  // the dark→structural transition narrowed (width 0.36→0.18) so the
  // progression reads as a snappier "dark, dark, dark, sudden structure"
  // rhythm rather than a slow blue gradient occupying a third of the range.
  // A seed-gated violet accent now also appears in THIS tier's upper portion
  // (not just the electric→cyan handoff below) — "deep indigo → muted
  // blue-violet → electric blue → cyan" per the requested sequence, reusing
  // the same seed value already in scope (no new noise sample).
  // Color + Energy Mapping, Stage 2 calibration pass — these four
  // thresholds (previously 0.44 / 0.62 / 0.87 / 0.965) are RECALIBRATED to
  // the eff distribution the approved Fold #1+#2 geometry actually produces
  // (measured via a temporary pixel-readback diagnostic during Thinking:
  // mean~0.018, p90~0.027, p95~0.106, p99~0.19, max~0.22 in the sampled
  // frame — essentially none of the membrane reached the old 0.44 floor at
  // all, which is why cyan/electric-blue/violet were invisible). The
  // relationship/order (dark→electric-blue/violet→cyan-base→cyan-bright→
  // cyan-extreme) and the violet-gating mechanism are UNCHANGED — only the
  // numeric boundaries moved to match the new range. This is a threshold
  // recalibration, not a redesign: rampEnergy()/energyMask() above are
  // untouched, so the SELECTIVITY (why eff is low almost everywhere) is
  // exactly as designed — only where the ramp starts reacting to it changed.
  if (t > 0.0) {
    if (eff < 0.03) return DEEP_BLUE;
    if (eff < 0.055) {
      float frac = (eff - 0.03) / 0.025;
      vec3 base = mix(DEEP_BLUE, ELECTRIC_BLUE, frac);
      float violetGateA = step(0.75, fract(seed * 13.7 + 4.2));
      return mix(base, VIOLET, frac * frac * 0.22 * violetGateA);
    }
    if (eff < 0.09) {
      float frac = (eff - 0.055) / 0.035;
      // Stage 2 palette pass: frac SQUARED (was linear) — most of this
      // tier now stays close to the (now-darkened) ELECTRIC_BLUE and only
      // eases toward CYAN_BASE right at the 0.09 edge, so "mid-energy"
      // reads as deep saturated blue rather than pale/pastel for most of
      // its range, with cyan reserved for the genuine top of the tier.
      vec3 base = mix(ELECTRIC_BLUE, CYAN_BASE, frac * frac);
      // Violet transition accent, widened slightly from Checkpoint G's 5th
      // pass (~18%→~28% of particles) per "violet as structural bridge."
      float violetWindow = 1.0 - abs(frac * 2.0 - 1.0);
      float violetGate = step(0.72, fract(seed * 13.7 + 4.2));
      return mix(base, VIOLET, violetWindow * 0.16 * violetGate);
    }
    // Stage 2 palette pass: mild pow() curve (was linear) so CYAN_BRIGHT is
    // reached only very near the 0.16 edge — bright cyan stays reserved for
    // the true peak, not the whole top tier.
    if (eff < 0.16) return mix(CYAN_BASE, CYAN_BRIGHT, pow((eff - 0.09) / 0.07, 1.4));
    // Denominator widened (was 0.035) so the measured max (~0.22) only
    // reaches a small fraction of the way toward CYAN_EXTREME — near-white
    // stays a trace/negligible accent this stage, not a reachable tier.
    return mix(CYAN_BRIGHT, CYAN_EXTREME, clamp((eff - 0.16) / 0.28, 0.0, 1.0));
  }
  // Stage 3 amber calibration pass — thresholds recalibrated, same
  // evidence-first methodology as the cyan pass. Diagnostic pixel-readback
  // (amber-side eff, isolated via discard on t>=0) showed the OLD
  // thresholds (0.5/0.66/0.91) sat entirely outside the eff range this
  // geometry/energyAmber mask can actually produce — even |t| reaching
  // 0.58 (confirmed via a separate abs(t) readback, so displacement magnitude
  // was never the bottleneck) combined with GAMMA_AMBER=3.8 and the 0.025
  // floor meant eff rounded to exactly 0 for ~100% of the sampled amber
  // population across two independent samples (47k and 50k pixels) — amber
  // was completely invisible, not merely subordinate. Measured achievable
  // range after lowering GAMMA_AMBER (see below): p99≈0.008, max≈0.04-0.11
  // (varies — the energyAmber mask is itself a sparse, traveling structure,
  // same as cyan's). Thresholds placed to match: the flat-dark zone now
  // covers the ~99th percentile (amber stays invisible on all but the
  // rarest particles, deliberately sparser than cyan's own thresholds per
  // this stage's "extremely rare peak" requirement), with AMBER_EXTREME
  // reachable only by genuine outlier peaks near the measured max.
  if (eff < 0.01) return DEEP_AMBER;
  if (eff < 0.025) return mix(DEEP_AMBER, AMBER_BASE, (eff - 0.01) / 0.015);
  if (eff < 0.06) return mix(AMBER_BASE, AMBER_INTENSE, (eff - 0.025) / 0.035);
  return mix(AMBER_INTENSE, AMBER_EXTREME, clamp((eff - 0.06) / 0.06, 0.0, 1.0));
}

// Phase 8 Checkpoint C — the internal amber nucleus, entirely emergent: no
// second mesh, no literal inner sphere. Reads as a concentration of warm
// energy that becomes visible "through" the particle shell rather than a
// flat patch painted on the surface. Three factors, all already available:
//   1. How deep into the amber (valley/interior) side of the SAME
//      displacement field this particle already sits (t < 0, Checkpoint B).
//   2. facing01 — particles facing AWAY from camera (rear-ish, facing01 near
//      0) are the ones a viewer is looking THROUGH nearer particles to see,
//      which is what makes a concentration read as "internal" rather than
//      "on the surface." Front-facing valley particles stay closer to plain
//      amber-base — they're a visible dip in the surface, not the nucleus.
//   3. vSeed — deterministic per-particle variance so the glow has organic
//      irregularity instead of reading as one smooth internal light source.
// Returns an ADDITIONAL blend-toward-nucleus-color factor (0 = no nucleus
// contribution, plain ramp color stands) — never invoked on the cyan side.
float nucleusFactor(float t, float facing01, float seed, float energyAmber) {
  if (t >= 0.0) return 0.0;
  // Checkpoint H, final pass: qualifying range narrowed further (0.4→0.46)
  // to match the amber ramp's own widened flat-dark zone above.
  float depth = clamp((-t - 0.46) / 0.54, 0.0, 1.0);
  // Internal-facing bias: rear-facing particles read as "seen through" the
  // structure, front-facing valley particles stay as plain surface amber.
  float internalBias = smoothstep(0.42, 0.0, facing01);
  // Checkpoint H, 2nd pass: per-particle random variance narrowed sharply
  // (was 0.55–1.1 — a genuinely random per-particle multiplier, which was a
  // direct source of the "orange speckling" complaint, since it modulates
  // brightness independently of any neighbor). Now 0.85–1.0 — enough to keep
  // an organic, non-mechanical edge without visibly speckling.
  float variance = 0.85 + 0.15 * seed;
  // Checkpoint H, 2nd pass: multiplied by the SAME coherent energyAmber
  // mask the base ramp uses (rampEnergy's amber branch) — previously this
  // glow had its own independent depth/facing/seed gate with no spatial
  // relationship to where the ramp itself was placing amber, so the two
  // amber sources didn't visually agree, reading as scattered speckles.
  // Now both mechanisms only ever activate in the same coherent regions.
  return clamp(pow(depth, 2.8) * internalBias * variance * energyAmber, 0.0, 1.0); // exponent 2.4→2.8 — sharper concentration, matching amber's snappier ramp rhythm
}

// Phase 8 Checkpoint F — sparse, spatially-coherent internal neural
// activation. Two decorrelated 3D simplex-noise fields sampled at this
// particle's own stable direction (vDir, not a per-particle-random value) so
// neighboring particles share similar noise values — this is what produces
// "pathways/concentrations" rather than independent per-particle sparkle.
// Both fields drift through noise-space over time (never sin(time)), so the
// pattern migrates continuously with no fixed short loop. Returns a 0..1
// blend factor; callers gate the color/opacity impact.
float neuralActivation(vec3 dir, float facing01, float seed, float neuralActivity, float time) {
  if (neuralActivity < 0.01) return 0.0; // cheap escape — see uNeuralActivity comment above

  // Higher neuralActivity (Acting > Researching > Thinking) also nudges the
  // pattern's own drift rate — "somewhat faster/more decisive" in Acting —
  // without a separate per-state animation system; it falls out of the one
  // parameter already driving intensity.
  float t2 = time * (0.55 + neuralActivity * 0.6);

  float nA = snoise(dir * 3.2 + vec3(0.31, -0.24, 0.18) * t2);
  float nB = snoise(dir * 5.7 + vec3(-0.22, 0.27, -0.15) * t2 * 1.4 + 19.4);
  float raw = nA * 0.6 + nB * 0.4; // roughly [-1, 1]

  // Sparse activation: only the upper tail of the combined noise field
  // crosses the threshold at any moment — a small, shifting percentage of
  // particles, not the whole body. More active states afford a slightly
  // lower threshold (a bit more coverage), but the cap below keeps even
  // Acting restrained.
  float threshold = mix(0.72, 0.58, clamp(neuralActivity / 0.4, 0.0, 1.0));
  float activation = smoothstep(threshold, threshold + 0.12, raw);

  // Per-particle irregularity so an activated region doesn't read as one
  // smooth painted patch — organic, not geometric.
  float seedMod = 0.6 + 0.4 * fract(seed * 7.0 + 3.1);
  activation *= seedMod;

  // Internal-read bias: strongly favor rear/internal-facing particles (seen
  // THROUGH the lattice, same principle as the nucleus) over front-facing
  // ones, without making it fully invisible from the front.
  activation *= mix(0.4, 1.0, 1.0 - facing01);

  return clamp(activation * neuralActivity, 0.0, 1.0);
}

void main() {
  // Colorspace proof-test diagnostic — highest priority, bypasses even the
  // circular-sprite discard so every covered pixel outputs the exact same
  // known flat value, giving the cleanest possible readback.
  if (uGrayTestValue >= 0.0) {
    vec3 gtColor = uGrayTestCorrected > 0.5 ? srgbToLinear(vec3(uGrayTestValue)) : vec3(uGrayTestValue);
    gl_FragColor = vec4(gtColor, 1.0);
    return;
  }
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard; // circular sprite; discard also skips the depth write outside it

  // Checkpoint H, material-presence pass: falloff window narrowed
  // 0.5→0.15 (width 0.35) → 0.5→0.30 (width 0.20) — at a ~4px sprite, the
  // old wide feathered edge meant most of a particle's visible area was
  // soft antialiasing rather than solid core, reinforcing a hologram-like
  // read. A crisper edge makes each individual dot look like a solid point.
  float edge = smoothstep(0.5, 0.30, d) * vOpacityJitter;

  // Phase 8 Checkpoint B: color driven directly by vFieldNormalized (the
  // SAME deformation field that shapes the body, Phase-1-style) rather than
  // the old single-sided "activity" remap — raised/outward regions read
  // cyan, valleys/inward regions read amber. uActivityIntensity still gives
  // per-state a small pull toward the cyan side (more "active" states read
  // slightly more exterior-energetic) without needing the old bias/threshold
  // machinery; kept intentionally small so displacement stays the primary
  // color driver per the brief.
  // Checkpoint H motion-grammar: uWarmEmphasis adds a small bias alongside
  // the existing uActivityIntensity term — same mechanism, same t value
  // every downstream tier/seam calculation already uses. At the neutral
  // default (0.0) this is a no-op.
  float t = clamp(vFieldNormalized + uActivityIntensity * 0.6 - uWarmEmphasis * 0.5, -1.0, 1.0);

  // Checkpoint G, 5th pass: independent, slowly-drifting energy field (see
  // energyMask/rampEnergy above) decides where illumination is currently
  // visible, decoupled from raw displacement — this is what turns whole
  // painted lobe faces into selective traveling ridges/concentrations.
  // Checkpoint H motion-grammar: uFlowSpeed multiplies only this field's own
  // time term (never geometry/rotation time); uCoherence shapes its gate
  // widths (see energyMask); uEnergyIntensity scales the resulting mask
  // itself — PARTICIPATION of the energy field, not a brightness multiplier
  // — so lower cognition means less of the membrane engages the field at
  // all (dark body stays visible underneath), not a dimmer version of the
  // same coverage. All four reduce to exact no-ops at their neutral
  // defaults (1, 1, 1, 0).
  float energyTime = uTime * uFlowSpeed;

  // Phase 4: a single shared, slowly-wandering OBJECT-SPACE reference
  // direction — one "current direction of travel" for the whole membrane,
  // not per-particle-random. Sum of incommensurate-frequency sines (same
  // quasi-periodic, non-mechanical-looking technique as motion.ts's quasi()
  // on the CPU side, reimplemented here since GPU code can't import it) —
  // its effective repeat period is on the order of minutes, so a viewer
  // watching for several seconds cannot identify "it rotates once every X
  // seconds." Evolves at energyTime's rate (flowSpeed-coupled) so a more
  // decisive state's reference direction also wanders a bit faster.
  vec3 dirRef = normalize(vec3(
    sin(energyTime * 0.037) + 0.5 * sin(energyTime * 0.081 + 1.7),
    sin(energyTime * 0.053 + 2.1) + 0.5 * sin(energyTime * 0.029 + 0.4),
    sin(energyTime * 0.071 + 4.3) + 0.5 * sin(energyTime * 0.045 + 3.1)
  ));

  float energyCyan = clamp(energyMask(vDir, energyTime, 0.0, uCoherence, uDirectionality, uTurbulence, dirRef, uCyanRidgeWidth, uCyanBroadFloor, uCyanTerritoryThreshold) * uEnergyIntensity, 0.0, 1.0);
  float energyAmber = clamp(energyMask(vDir, energyTime, 47.3, uCoherence, uDirectionality, uTurbulence, dirRef, 1.0, 0.0, -2.0) * uEnergyIntensity, 0.0, 1.0);
  float eff = rampEnergy(t, energyCyan, energyAmber);
  vec3 rampColor = coreColorRamp(t, vSeed, eff);

  if (uAmberMaskDebug > 0.5) {
    if (t >= 0.0) discard;
    gl_FragColor = vec4(energyAmber, energyAmber, energyAmber, 1.0);
    return;
  }

  // Stage 5 diagnostic (window.__jarvisCyanMaskDebug): mirrors
  // uAmberMaskDebug for the cyan side — outputs the raw energyCyan spatial
  // gate directly (before rampEnergy/coreColorRamp), isolated to t>=0 via
  // discard, so a pixel readback shows WHERE cyan energy exists independent
  // of brightness/color.
  if (uCyanMaskDebug > 0.5) {
    if (t < 0.0) discard;
    gl_FragColor = vec4(energyCyan, energyCyan, energyCyan, 1.0);
    return;
  }

  if (uCyanTerritoryDebug > 0.5) {
    if (t < 0.0) discard;
    float tg = cyanTerritoryGate(vDir, energyTime, 0.0, uDirectionality, dirRef, uCyanTerritoryThreshold);
    gl_FragColor = vec4(tg, tg, tg, 1.0);
    return;
  }

  // Temporary calibration diagnostic (window.__jarvisEffDebug): outputs the
  // raw eff value as solid grayscale (alpha forced to 1, bypassing the
  // normal edge/opacity antialiasing) so a JS-side pixel readback can
  // measure the ACTUAL eff distribution the approved fold geometry
  // currently produces, before any threshold is retuned. Not a permanent
  // instrumentation path — reverted after this calibration pass.
  if (uEffDebug > 0.5) {
    gl_FragColor = vec4(eff, eff, eff, 1.0);
    return;
  }

  // Stage 3 diagnostic (window.__jarvisAmberEffDebug): isolates the
  // amber-side (t<0) eff population — same eff value, same rampEnergy()
  // output, just restricted via discard so a pixel readback measures the
  // amber distribution without cyan-side pixels mixed in. R=eff, G=energyAmber
  // in the SAME single draw call — added so a same-instant readback can
  // compare eff directly against its own energyAmber mask value without the
  // temporal drift of capturing mask and eff in two separate frames (which
  // measurably misclassified boundary particles during floor-leak
  // diagnosis, since the ridge is only 1-3px wide on screen and a couple of
  // frames' drift shifts it).
  if (uAmberEffDebug > 0.5) {
    if (t >= 0.0) discard;
    gl_FragColor = vec4(eff, energyAmber, 0.0, 1.0);
    return;
  }

  if (uTMagDebug > 0.5) {
    if (t >= 0.0) discard;
    float tm = abs(t);
    gl_FragColor = vec4(tm, tm, tm, 1.0);
    return;
  }

  // Depth: front/rear brightness falloff from Phase 1's facing signal.
  // Rear stays dim, not fully black — the body must still read as one
  // complete volumetric object, not a lit hemisphere.
  // Checkpoint G, 3rd pass: curved (pow 1.7) rather than a linear mix — only
  // particles genuinely close to dead-on-facing now reach full brightness;
  // grazing/side-facing particles (most of a sphere's visible surface from
  // any one viewing angle) fall further toward uRearDarken. This is what
  // lets a viewer see further into/through the structure rather than the
  // whole front hemisphere reading as uniformly lit.
  float facing01 = clamp(vFacing * 0.5 + 0.5, 0.0, 1.0);

  // Dev-only mono diagnostic: pure geometry/depth in grayscale, bypassing
  // color/nucleus/neural/highlight entirely — a deliberately HIGHER rear
  // floor (0.14, vs. production's uRearDarken≈0.045) so the far/rear
  // surface stays visible enough to judge whether it reads as a genuine
  // hollow shell (near surface + curved sides + dim far surface seen
  // through it) rather than a solid mass, independent of any color choice.
  // Checkpoint G, 8th pass: exponent raised 1.7→2.2 (shared with the
  // production depthFactor below — this is the same underlying facing
  // signal, just curved harder) so only particles genuinely close to
  // dead-on-facing reach full brightness; the front "cap" region shrinks
  // and the falloff toward the rim/sides is more pronounced, which is what
  // makes the sphere read as curved volume rather than a uniformly-lit disc.
  if (uMonoDebug > 0.5) {
    float mono = mix(0.14, 1.0, pow(facing01, 2.2));
    gl_FragColor = vec4(vec3(mono), edge * uOpacity * vDepthOpacity);
    return;
  }

  float depthFactor = mix(uRearDarken, uFrontBoost, pow(facing01, 2.2));

  // Color + Energy Mapping — Stage 1 diagnostic: flat dark membrane tone
  // through the REAL production depth system, nothing else. Tests whether
  // the dark base + depth treatment alone reads as a hollow, readable
  // membrane before any energy/color accent is layered on top.
  if (uColorStage1 > 0.5) {
    vec3 stage1 = DEEP_BLUE * depthFactor;
    gl_FragColor = vec4(srgbToLinear(stage1), edge * uOpacity * vDepthOpacity);
    return;
  }

  // Color + Energy Mapping — Stage 2 diagnostic: COOL energy only. Reuses
  // the EXISTING coreColorRamp/rampEnergy/energyMask pipeline verbatim — no
  // new mask, no new noise sample. Two deliberate restrictions on top of
  // the unchanged machinery:
  //   1. The amber (t<0) side is bypassed entirely and forced to the SAME
  //      flat DEEP_BLUE as Stage 1 — coreColorRamp's amber branch is simply
  //      never called this stage, so no amber anchor can appear.
  //   2. eff is capped below 0.965 before reaching coreColorRamp, so the
  //      ramp can climb DEEP_BLUE→ELECTRIC_BLUE→(violet accents)→
  //      CYAN_BASE→CYAN_BRIGHT but can never enter the CYAN_BRIGHT→
  //      CYAN_EXTREME tier — CYAN_EXTREME is near-white, explicitly
  //      excluded this stage.
  // The SELECTIVITY itself — why this doesn't paint broad regions — comes
  // entirely from the untouched existing design: eff is proportional to
  // energyCyan (energyMask()'s broadGate*ridgeGate double-gate, already a
  // thin/traveling structure by construction, decorrelated from geometry
  // since it samples its own independent noise field at vDir), and
  // coreColorRamp's own flat-dark zone (eff<0.44) already keeps any
  // particle the energy mask isn't currently touching at plain DEEP_BLUE
  // regardless of how elevated its displacement (t, fold-inclusive) is.
  if (uColorStage2 > 0.5) {
    vec3 stage2Color = t >= 0.0 ? coreColorRamp(t, vSeed, min(eff, 0.94)) : DEEP_BLUE;
    vec3 stage2Shaded = stage2Color * depthFactor;
    float rim2 = 1.0 - smoothstep(0.0, 0.4, abs(vFacing));
    stage2Shaded *= (1.0 + rim2 * 0.09);

    // Diagnostic pass (window.__jarvisFinalFrontDebug): same stage2Shaded
    // value production would blend, but output opaque + front-facing-only
    // so a pixel readback measures the true final RGB reaching the
    // framebuffer for the front hemisphere specifically, with no alpha/AA
    // ambiguity. Not implemented as a tuning change — read-only.
    if (uFinalFrontDebug > 0.5) {
      if (facing01 <= 0.5) discard;
      gl_FragColor = vec4(srgbToLinear(stage2Shaded), 1.0);
      return;
    }

    gl_FragColor = vec4(srgbToLinear(stage2Shaded), edge * uOpacity * vDepthOpacity);
    return;
  }

  vec3 shaded = rampColor * depthFactor;

  // Phase 8 Checkpoint C — internal nucleus. Deliberately blended AFTER
  // depthFactor (not multiplied by it): the nucleus represents an internal
  // energy concentration a viewer is looking THROUGH the particle shell to
  // see, so it should read warmer/brighter than plain rear-darkened amber
  // would, not be additionally dimmed by the same falloff that identifies it
  // as internal in the first place.
  // Checkpoint G retune: target color pulled back from INTENSE/EXTREME to
  // BASE/INTENSE, and the max blend cut from 0.65 → 0.42 — the nucleus
  // should read as a localized, embedded concentration (most of it barely
  // brighter than the surrounding dark amber), not a large bright patch.
  // AMBER_EXTREME is now reserved for only the deepest, most internal-facing
  // peaks (nucleus approaching 1.0), consistent with "near-white is an
  // accent, not a base color."
  float nucleus = nucleusFactor(t, facing01, vSeed, energyAmber);
  vec3 nucleusGlow = mix(AMBER_BASE, AMBER_INTENSE, clamp(nucleus * 1.05, 0.0, 1.0));
  shaded = mix(shaded, nucleusGlow, nucleus * 0.42);

  // Phase 8 Checkpoint F — internal neural activation. Reinforces the
  // existing cyan/amber identity rather than introducing a new palette:
  // near-white-cyan on the cyan side of the field, a restrained near-white-
  // amber on the amber side. Capped blend (0.5 max) keeps activation as a
  // localized accent, not a brightening of the whole body — deliberately
  // small so this does NOT add to the Core's current white-highlight
  // dominance (that correction is reserved for Checkpoint G).
  float neural = neuralActivation(vDir, facing01, vSeed, uNeuralActivity, uTime);
  vec3 neuralColor = t >= 0.0
    ? vec3(0.75, 0.97, 1.00)  // near-white cyan
    : vec3(1.00, 0.93, 0.65); // restrained near-white amber/yellow
  shaded = mix(shaded, neuralColor, clamp(neural, 0.0, 0.5));

  // Phase 8 Checkpoint C — controlled rim highlighting. Particles near
  // vFacing≈0 sit at the silhouette edge, neither front nor rear; a small
  // brightness lift there (not a color change) is what makes the Core's
  // edge read crisply against the backdrop instead of the front hemisphere
  // simply fading to nothing.
  // Checkpoint G retune: reduced +18% → +9% — this was one of several
  // brightness terms stacking on top of an already-bright base ramp; with
  // the ramp itself now much darker, a smaller rim lift is enough to read
  // as an irregular edge accent rather than a continuous glowing outline.
  float rim = 1.0 - smoothstep(0.0, 0.4, abs(vFacing));
  shaded *= (1.0 + rim * 0.09);

  // Localized highlight: only the most extreme-displacement, most
  // front-facing particles get an EXTRA push toward their ramp's own near-
  // white peak (cyan side → #cdefff, amber side → #fff2cc — not a single
  // fixed highlight color, since the ramp itself is now two-sided).
  // Checkpoint G, 5th pass: now gated by the SAME eff value the color ramp
  // itself uses (point 7 — highlight and color must agree on what "extreme"
  // means), instead of a separately-computed pow(|t|,3) that could drift out
  // of sync with the ramp's own gamma/energy-gating whenever those are
  // retuned (this caused the earlier white-hotspot regression).
  vec3 highlightTarget = t >= 0.0 ? CYAN_EXTREME : AMBER_EXTREME;
  float hi = smoothstep(0.9, 0.995, eff * facing01) * uHighlightStrength;
  vec3 color = mix(shaded, highlightTarget, hi);

  // Phase 8 Checkpoint C — subtle rear-particle opacity attenuation
  // (vDepthOpacity, computed in the vertex shader from the same facing
  // signal) layers onto the existing edge/opacity-jitter alpha rather than
  // replacing it — reinforces depth without touching depthTest/depthWrite
  // or the material's blend mode.
  gl_FragColor = vec4(srgbToLinear(color), edge * uOpacity * vDepthOpacity);
}
`;

// ───────────────────────── the body ─────────────────────────────────────────
function JarvisBody({
  particleCount,
  params,
  state,
  stateEnteredAt,
  speechAmplitude,
}: {
  particleCount: number;
  params: JarvisParams;
  state: JarvisState;
  stateEnteredAt: number;
  speechAmplitude: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { gl } = useThree();

  // `params` is the TARGET profile — Phase 3's state controller changes it
  // whenever the authoritative JarvisState changes. It can jump between
  // renders (a state change is not itself animated), so the frame loop below
  // eases a separate set of LIVE values toward it every frame rather than
  // assigning target → uniform directly. Phase 4: the easing rate is now
  // per-(state, parameter) via motion.ts's getTau — see the frame loop.
  // `live` itself only ever eases toward `target`; continuous motion and
  // transient envelopes (also motion.ts) are added as a separate DISPLAY
  // overlay each frame so they never accumulate into or shift the settle
  // point. This loop has zero knowledge of what any JarvisState "means" —
  // it only calls motion.ts functions and sums numbers.
  const targetParamsRef = useRef(params);
  targetParamsRef.current = params;
  const stateRef = useRef(state);
  stateRef.current = state;
  const liveRef = useRef<Record<(typeof TWEENABLE_KEYS)[number], number>>({
    radius: params.radius,
    displacementIntensity: params.displacementIntensity,
    compressionAmount: params.compressionAmount,
    pulseStrength: params.pulseStrength,
    timeScale: params.timeScale,
    rotationSpeed: params.rotationSpeed,
    activityIntensity: params.activityIntensity,
    highlightStrength: params.highlightStrength,
    neuralActivity: params.neuralActivity,
    energyIntensity: params.energyIntensity,
    flowSpeed: params.flowSpeed,
    coherence: params.coherence,
    warmEmphasis: params.warmEmphasis,
    directionality: params.directionality,
    turbulence: params.turbulence,
    ampFold: params.ampFold,
    ampFold2: params.ampFold2,
  });
  // Raw speechAmplitude smoothed with its own dedicated (fast) time-constant
  // — a low-pass on the INPUT signal itself, distinct from the per-key
  // TRANSITION_TAU above which smooths the DERIVED params. Matters once a
  // real audio-analyser feeds this instead of the dev-panel slider.
  const liveAmplitudeRef = useRef(speechAmplitude);
  const speechAmplitudeRef = useRef(speechAmplitude);
  speechAmplitudeRef.current = speechAmplitude;
  const stateEnteredAtRef = useRef(stateEnteredAt);
  stateEnteredAtRef.current = stateEnteredAt;

  const { dir, seed } = useMemo(
    // Stage 4, distribution-correction pass — LOCKED, approved: replaces the
    // raw unperturbed Fibonacci lattice with a deterministic tangent-plane
    // jitter (see buildFibonacciSphereRelaxed's own comment for the full
    // diagnosis/derivation). Do not revert to buildFibonacciSphere() —
    // verified via mono-diagnostic A/B that the raw lattice produces an
    // unmistakable diagonal spiral weave at production-scale brightness,
    // which this fixes while preserving uniform global coverage.
    () => buildFibonacciSphereRelaxed(particleCount),
    [particleCount]
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: params.radius },
      uFreqA: { value: params.freqA },
      uAmpA: { value: params.ampA },
      uDriftA: { value: new THREE.Vector3(...params.driftA) },
      uLobeBias: { value: params.lobeBiasExponent },
      uFreqB: { value: params.freqB },
      uAmpB: { value: params.ampB },
      uDriftB: { value: new THREE.Vector3(...params.driftB) },
      uFreqC: { value: params.freqC },
      uAmpC: { value: params.ampC },
      uDriftC: { value: new THREE.Vector3(...params.driftC) },
      uDisplacementIntensity: { value: params.displacementIntensity },
      uCompressionAmount: { value: params.compressionAmount },
      uPulseStrength: { value: params.pulseStrength },
      uParticleSize: { value: params.particleSize },
      uPixelRatio: { value: gl.getPixelRatio() },
      uOpacity: { value: params.opacity },
      uActivityFieldLow: { value: params.activityFieldLow },
      uActivityFieldHigh: { value: params.activityFieldHigh },
      uActivityBias: { value: params.activityBias },
      uActivityIntensity: { value: params.activityIntensity },
      uHighlightColor: { value: new THREE.Color(...params.highlightColor) },
      uHighlightStrength: { value: params.highlightStrength },
      uRearDarken: { value: params.rearDarken },
      uFrontBoost: { value: params.frontBoost },
      uNeuralActivity: { value: params.neuralActivity },
      uEnergyIntensity: { value: params.energyIntensity },
      uFlowSpeed: { value: params.flowSpeed },
      uCoherence: { value: params.coherence },
      uWarmEmphasis: { value: params.warmEmphasis },
      uDirectionality: { value: params.directionality },
      uTurbulence: { value: params.turbulence },
      uCyanRidgeWidth: { value: params.cyanRidgeWidth },
      uCyanBroadFloor: { value: params.cyanBroadFloor },
      uCyanTerritoryThreshold: { value: params.cyanTerritoryThreshold },
      uCyanMaskDebug: { value: 0 },
      uCyanTerritoryDebug: { value: 0 },
      uAmpFold: { value: params.ampFold },
      uFoldCenter: { value: new THREE.Vector3(0, 1, 0) },
      uFoldAxis: { value: new THREE.Vector3(1, 0, 0) },
      uAmpFold2: { value: params.ampFold2 },
      uFoldCenter2: { value: new THREE.Vector3(0, -1, 0) },
      uFoldAxis2: { value: new THREE.Vector3(0, 0, 1) },
      // Controlled organic irregularity — 0..1 gates, dev-controllable via
      // window.__jarvisWarpTraj/Width/Strength (default 1.0 = fully
      // enabled) for this sub-phase's staged trajectory→width→strength
      // validation sequence, same override pattern as uAmpFold.
      uWarpTraj: { value: 1 },
      uWarpWidth: { value: 1 },
      uWarpStrength: { value: 1 },
      uMonoDebug: { value: 0 },
      uColorStage1: { value: 0 },
      uColorStage2: { value: 0 },
      uEffDebug: { value: 0 },
      uFinalFrontDebug: { value: 0 },
      uGrayTestValue: { value: -1 },
      uGrayTestCorrected: { value: 0 },
      uAmberEffDebug: { value: 0 },
      uTMagDebug: { value: 0 },
      uAmberMaskDebug: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Bounding sphere padded past the max possible displaced radius so the
  // single draw call is never frustum-culled early as the body deforms.
  const boundingRadius =
    params.radius +
    Math.abs(params.ampA) +
    Math.abs(params.ampB) +
    Math.abs(params.ampC) +
    0.5;

  const timeAccum = useRef(0);

  useFrame((_, delta) => {
    const target = targetParamsRef.current;
    const live = liveRef.current;
    const st = stateRef.current;
    const dt = Math.min(delta, 0.1);

    // 1. TRANSITION TIMING — per-(state, parameter) exponential smoothing
    // toward the current target (motion.ts's getTau). Because this only
    // ever depends on the CURRENT live value and the CURRENT target, a
    // target change mid-transition redirects immediately from wherever
    // `live` currently sits — no queue, no finishing the previous state
    // first, no reset. That is what "transition redirection" requires, and
    // it falls out of the math rather than needing special-case code.
    for (const key of TWEENABLE_KEYS) {
      const tau = getTau(st, key);
      const k = 1 - Math.exp(-dt / tau);
      live[key] += (target[key] - live[key]) * k;
    }

    timeAccum.current += dt * live.timeScale;
    const t = timeAccum.current;

    // 2 & 3. CONTINUOUS MOTION + TRANSIENT ENVELOPES — additive overlays
    // computed fresh every frame, summed into a separate `display` object.
    // Never fed back into `live`, so they ride on top of the settle point
    // instead of shifting or accumulating into it.
    const display: Record<(typeof TWEENABLE_KEYS)[number], number> = { ...live };
    const continuous = getContinuousMotion(st, t);
    for (const key of TWEENABLE_KEYS) {
      const delta2 = continuous[key];
      if (delta2) display[key] += delta2;
    }
    if (st === "complete") {
      const elapsedS = (performance.now() - stateEnteredAtRef.current) / 1000;
      const envelope = getCompleteEnvelope(elapsedS);
      for (const key of TWEENABLE_KEYS) {
        const delta2 = envelope[key];
        if (delta2) display[key] += delta2;
      }
    }
    if (st === "speaking") {
      // Low-pass the raw amplitude input itself (SPEECH_AMPLITUDE_TAU),
      // then map the smoothed value to param offsets (motion.ts) — voice
      // modulates this SAME body, never a separate waveform/bar visualizer.
      const kAmp = 1 - Math.exp(-dt / SPEECH_AMPLITUDE_TAU);
      liveAmplitudeRef.current += (speechAmplitudeRef.current - liveAmplitudeRef.current) * kAmp;
      const mod = getSpeakingModulation(liveAmplitudeRef.current);
      for (const key of TWEENABLE_KEYS) {
        const delta2 = mod[key];
        if (delta2) display[key] += delta2;
      }
    } else {
      // Not speaking: relax the smoothed amplitude back toward 0 so a
      // later re-entry into Speaking doesn't inherit a stale loud value.
      liveAmplitudeRef.current *= 0.9;
    }

    const u = materialRef.current?.uniforms;
    if (u) {
      u.uTime.value = t;
      u.uRadius.value = display.radius;
      u.uFreqA.value = target.freqA;
      u.uAmpA.value = target.ampA;
      (u.uDriftA.value as THREE.Vector3).set(...target.driftA);
      u.uLobeBias.value = target.lobeBiasExponent;
      u.uFreqB.value = target.freqB;
      u.uAmpB.value = target.ampB;
      (u.uDriftB.value as THREE.Vector3).set(...target.driftB);
      u.uFreqC.value = target.freqC;
      u.uAmpC.value = target.ampC;
      (u.uDriftC.value as THREE.Vector3).set(...target.driftC);
      u.uDisplacementIntensity.value = display.displacementIntensity;
      u.uCompressionAmount.value = display.compressionAmount;
      u.uPulseStrength.value = display.pulseStrength;
      u.uParticleSize.value = target.particleSize;
      u.uOpacity.value = target.opacity;
      u.uActivityFieldLow.value = target.activityFieldLow;
      u.uActivityFieldHigh.value = target.activityFieldHigh;
      u.uActivityBias.value = target.activityBias;
      u.uActivityIntensity.value = display.activityIntensity;
      (u.uHighlightColor.value as THREE.Color).setRGB(...target.highlightColor);
      u.uHighlightStrength.value = display.highlightStrength;
      u.uRearDarken.value = target.rearDarken;
      u.uFrontBoost.value = target.frontBoost;
      u.uCyanRidgeWidth.value = target.cyanRidgeWidth;
      u.uCyanBroadFloor.value = target.cyanBroadFloor;
      u.uCyanTerritoryThreshold.value = target.cyanTerritoryThreshold;
      u.uNeuralActivity.value = display.neuralActivity;
      u.uEnergyIntensity.value = display.energyIntensity;
      u.uFlowSpeed.value = display.flowSpeed;
      u.uCoherence.value = display.coherence;
      u.uWarmEmphasis.value = display.warmEmphasis;
      u.uDirectionality.value = display.directionality;
      u.uTurbulence.value = display.turbulence;

      // Membrane Expression Sub-Phase 1. window.__jarvisFoldAmp is a
      // dev-only override for THIS validation pass (mirrors the existing
      // __jarvisMonoDebug pattern) — it lets ampFold be bumped live in the
      // browser console without redeploying, per the checkpoint's explicit
      // "increase only in small increments during visual validation"
      // instruction, without touching the true DEFAULT_PARAMS.ampFold=0.
      const foldAmpDebug =
        typeof window !== "undefined" &&
        typeof (window as unknown as { __jarvisFoldAmp?: number }).__jarvisFoldAmp === "number"
          ? (window as unknown as { __jarvisFoldAmp?: number }).__jarvisFoldAmp!
          : null;
      u.uAmpFold.value = foldAmpDebug !== null ? foldAmpDebug : display.ampFold;
      // foldCenter/foldAxis evolve far slower than energy's own wandering
      // reference (Phase 4's dirRef) — folds should migrate over tens of
      // seconds, not flicker with cognitive energy's faster pace.
      const foldRef = getFoldReference(t * 0.06);
      (u.uFoldCenter.value as THREE.Vector3).set(...foldRef.center);
      (u.uFoldAxis.value as THREE.Vector3).set(...foldRef.axis);

      // Membrane Expression Sub-Phase 2 — Fold #2, same dev-override
      // pattern as Fold #1 (window.__jarvisFoldAmp2), and its own
      // independently-evolving reference at a DIFFERENT time-rate (0.05 vs
      // Fold #1's 0.06) so the two never lock into a fixed relative phase.
      const foldAmp2Debug =
        typeof window !== "undefined" &&
        typeof (window as unknown as { __jarvisFoldAmp2?: number }).__jarvisFoldAmp2 === "number"
          ? (window as unknown as { __jarvisFoldAmp2?: number }).__jarvisFoldAmp2!
          : null;
      u.uAmpFold2.value = foldAmp2Debug !== null ? foldAmp2Debug : display.ampFold2;
      const foldRef2 = getFoldReference2(t * 0.05);
      (u.uFoldCenter2.value as THREE.Vector3).set(...foldRef2.center);
      (u.uFoldAxis2.value as THREE.Vector3).set(...foldRef2.axis);

      // Controlled organic irregularity — dev overrides for the staged
      // trajectory→width→strength validation sequence. Default 1.0 (fully
      // enabled) when no override is set.
      const w = window as unknown as {
        __jarvisWarpTraj?: number;
        __jarvisWarpWidth?: number;
        __jarvisWarpStrength?: number;
      };
      u.uWarpTraj.value = typeof window !== "undefined" && typeof w.__jarvisWarpTraj === "number" ? w.__jarvisWarpTraj : 1;
      u.uWarpWidth.value = typeof window !== "undefined" && typeof w.__jarvisWarpWidth === "number" ? w.__jarvisWarpWidth : 1;
      u.uWarpStrength.value = typeof window !== "undefined" && typeof w.__jarvisWarpStrength === "number" ? w.__jarvisWarpStrength : 1;

      u.uMonoDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisMonoDebug?: boolean }).__jarvisMonoDebug) ? 1 : 0;
      u.uColorStage1.value = (typeof window !== "undefined" && (window as unknown as { __jarvisColorStage1?: boolean }).__jarvisColorStage1) ? 1 : 0;
      u.uColorStage2.value = (typeof window !== "undefined" && (window as unknown as { __jarvisColorStage2?: boolean }).__jarvisColorStage2) ? 1 : 0;
      u.uEffDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisEffDebug?: boolean }).__jarvisEffDebug) ? 1 : 0;
      u.uFinalFrontDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisFinalFrontDebug?: boolean }).__jarvisFinalFrontDebug) ? 1 : 0;
      {
        const gtv = typeof window !== "undefined" ? (window as unknown as { __jarvisGrayTestValue?: number }).__jarvisGrayTestValue : undefined;
        u.uGrayTestValue.value = typeof gtv === "number" ? gtv : -1;
      }
      u.uGrayTestCorrected.value = (typeof window !== "undefined" && (window as unknown as { __jarvisGrayTestCorrected?: boolean }).__jarvisGrayTestCorrected) ? 1 : 0;
      u.uAmberEffDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisAmberEffDebug?: boolean }).__jarvisAmberEffDebug) ? 1 : 0;
      u.uTMagDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisTMagDebug?: boolean }).__jarvisTMagDebug) ? 1 : 0;
      u.uAmberMaskDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisAmberMaskDebug?: boolean }).__jarvisAmberMaskDebug) ? 1 : 0;
      u.uCyanMaskDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisCyanMaskDebug?: boolean }).__jarvisCyanMaskDebug) ? 1 : 0;
      u.uCyanTerritoryDebug.value = (typeof window !== "undefined" && (window as unknown as { __jarvisCyanTerritoryDebug?: boolean }).__jarvisCyanTerritoryDebug) ? 1 : 0;
    }
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * display.rotationSpeed;
      // A small always-on wobble on the tilt axis (motion.ts's
      // getTiltWobble) keeps even a single fixed rotation axis from reading
      // as a mechanical turntable — independent of state.
      groupRef.current.rotation.x = 0.12 + getTiltWobble(t);
    }
  });

  return (
    <group ref={groupRef}>
      <points frustumCulled={false}>
        <bufferGeometry
          onUpdate={(g) => {
            g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), boundingRadius);
          }}
        >
          <bufferAttribute attach="attributes-position" args={[dir, 3]} count={particleCount} array={dir} itemSize={3} />
          <bufferAttribute attach="attributes-aSeed" args={[seed, 1]} count={particleCount} array={seed} itemSize={1} />
        </bufferGeometry>
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          transparent
          depthWrite
          depthTest
        />
      </points>
    </group>
  );
}

// ───────────────────────── public component ────────────────────────────────
export type JarvisCore3DProps = {
  contained?: boolean;
  particleCount?: number; // Phase 8 perf profiles will override this
  params?: Partial<JarvisParams>;
  // Phase 4: passed straight through to the motion layer (components/jarvis/
  // motion.ts) — the renderer never branches on `state` itself, it only
  // forwards it so the right continuous-motion/envelope functions get
  // sampled. `stateEnteredAt` (ms, performance.now()-based) drives Complete's
  // release envelope; `speechAmplitude` (0–1) drives Speaking's modulation.
  state?: JarvisState;
  stateEnteredAt?: number;
  speechAmplitude?: number;
};

export default function JarvisCore3D({
  contained = false,
  particleCount = 18000,
  params: paramsOverride,
  state = "idle",
  stateEnteredAt,
  speechAmplitude = 0,
}: JarvisCore3DProps) {
  const params: JarvisParams = useMemo(
    () => ({ ...DEFAULT_PARAMS, ...paramsOverride }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(paramsOverride)]
  );
  // Only used when a caller doesn't pass stateEnteredAt (e.g. no controller
  // wired up) — a stable mount-time fallback so getCompleteEnvelope never
  // sees a moving target from a per-render performance.now() call.
  const fallbackEnteredAt = useRef(performance.now());

  return (
    <div
      style={{
        position: contained ? "absolute" : "fixed",
        inset: 0,
        zIndex: 15,
        pointerEvents: "none",
        background: "transparent",
      }}
    >
      <JarvisBoundary>
        <Canvas
          camera={{ position: [0, 0, 4.8], fov: 50 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          style={{ background: "transparent", pointerEvents: "none" }}
          onCreated={({ gl }) => {
            // WebGL context-loss handling, ported from ApexCore3D: without
            // preventDefault the loss is permanent and every subsequent
            // render throws.
            const canvas = gl.domElement;
            canvas.addEventListener(
              "webglcontextlost",
              (e) => {
                e.preventDefault();
                try {
                  console.warn("[jarvis] WebGL context lost — pausing");
                } catch {}
              },
              false
            );
            canvas.addEventListener(
              "webglcontextrestored",
              () => {
                try {
                  console.warn("[jarvis] WebGL context restored — resuming");
                } catch {}
              },
              false
            );
          }}
        >
          <JarvisBody
            particleCount={particleCount}
            params={params}
            state={state}
            stateEnteredAt={stateEnteredAt ?? fallbackEnteredAt.current}
            speechAmplitude={speechAmplitude}
          />
          {params.bloomEnabled && !(typeof window !== "undefined" && (window as unknown as { __jarvisComposerDebugDisable?: boolean }).__jarvisComposerDebugDisable) && (
            // Deliberately restrained relative to the old ApexCore3D orb
            // (intensity 1.8, threshold 0.15 there vs. 0.55/0.55 here): the
            // high threshold means only the coral/peach highlight particles
            // — not the indigo/violet body — cross into bloom, so the
            // silhouette and individual particles stay readable instead of
            // the whole core washing into a glow cloud.
            <EffectComposer>
              <Bloom
                intensity={params.bloomIntensity}
                luminanceThreshold={params.bloomThreshold}
                luminanceSmoothing={params.bloomSmoothing}
                radius={params.bloomRadius}
                mipmapBlur
              />
            </EffectComposer>
          )}
        </Canvas>
      </JarvisBoundary>
    </div>
  );
}
