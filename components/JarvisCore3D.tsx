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
  freqA: number; // broad-fold field: spatial frequency
  ampA: number; // broad-fold field: displacement amplitude
  driftA: [number, number, number]; // broad-fold field: noise-space drift (direction × speed)
  freqB: number; // ridged-crease field: spatial frequency
  ampB: number; // ridged-crease field: displacement amplitude
  driftB: [number, number, number]; // ridged-crease field: noise-space drift
  timeScale: number; // global evolution-speed multiplier for both fields
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
  freqA: 1.0, // was 1.4 (interim 1.1) — broader lobes so only 2–4 regions dominate at once
  ampA: 0.18, // was 0.16 (interim 0.27, 0.24) — softened: peaks were reading as separate attached bubbles rather than broad deformation of one body
  driftA: [0.15, 0.11, -0.09],
  freqB: 1.6, // was 3.1 (interim 1.9) — creases broad enough to read as accents, not surface texture
  ampB: 0.026, // was 0.1 (interim 0.045) — ridged layer reduced to a subtle secondary accent
  driftB: [-0.07, 0.13, 0.1],
  timeScale: 1.0,
  displacementIntensity: 1.0,
  compressionAmount: 0.0,
  pulseStrength: 0.0,
  rotationSpeed: 0.055,
  particleSize: 1.8, // was 2.6 — individual particles stay perceptible instead of merging into a solid surface
  opacity: 0.82, // was 0.92 — slight translucency so negative space between particles reads through

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
  highlightColor: [0.97, 0.9, 0.84], // soft near-white peach, not pure white
  highlightStrength: 0.35, // was 0.5 — even a fully-triggered highlight only partially blends now

  rearDarken: 0.16, // was 0.22 — significantly darker/richer, stronger front→side→rear separation; still clearly visible, not black
  frontBoost: 1.15, // was 1.12 — modest lift only; hue comes from the ramp, not from washing toward white

  bloomEnabled: true,
  bloomIntensity: 0.55, // restrained — was 1.8 in the old ApexCore3D orb, deliberately far lower
  bloomThreshold: 0.55, // only the coral/peach highlights cross this; indigo/violet stay crisp and un-bloomed
  bloomSmoothing: 0.25,
  bloomRadius: 0.3,
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
uniform float uFreqB;
uniform float uAmpB;
uniform vec3  uDriftB;
uniform float uDisplacementIntensity;
uniform float uCompressionAmount;
uniform float uPulseStrength;
uniform float uParticleSize;
uniform float uPixelRatio;

attribute float aSeed;

varying float vFacing;
varying float vField;
varying float vSeed;
varying float vOpacityJitter;

${SNOISE_GLSL}

void main() {
  vec3 dir = normalize(position); // Fibonacci base direction, stable per-particle identity

  // Broad low-frequency field → large asymmetric folds/bulges/valleys.
  float fieldA = snoise(dir * uFreqA + uDriftA * uTime);

  // Ridged mid-frequency field (1 - |noise|) → continuous crease lines
  // (compression seams) rather than more blobs.
  float ridgeRaw = snoise(dir * uFreqB + uDriftB * uTime + 31.7);
  float fieldB = (1.0 - abs(ridgeRaw)) - 0.6;

  float pulse = 1.0 + uPulseStrength;
  float field = (fieldA * uAmpA + fieldB * uAmpB) * pulse * uDisplacementIntensity;
  vField = field;

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

  gl_Position = projectionMatrix * mvPosition;
  float atten = uParticleSize * uPixelRatio * (280.0 / max(0.001, -mvPosition.z));
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
  vOpacityJitter = 0.72 + 0.28 * seedB; // new — static per-particle opacity variance, decorrelated from size
  gl_PointSize = clamp(atten * sizeJitter, 1.0, 40.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

uniform float uOpacity;

// Activity color (see JarvisParams for what each one controls)
uniform float uActivityFieldLow;
uniform float uActivityFieldHigh;
uniform float uActivityBias;
uniform float uActivityIntensity;
uniform vec3  uHighlightColor;
uniform float uHighlightStrength;

// Depth shading
uniform float uRearDarken;
uniform float uFrontBoost;

varying float vFacing;
varying float vField;
varying float vSeed;
varying float vOpacityJitter;

// The fixed 5-stop JARVIS identity ramp: muted indigo → dusty violet → mauve
// → muted coral → soft peach. This is JARVIS's visual language, not a tuning
// dial — later phases move particles ALONG this ramp (via the activity
// uniforms above), they don't replace the ramp itself. All muted/desaturated
// by design — no saturated neon-purple, no rainbow.
vec3 activityRamp(float t) {
  // Deepened cool end (tuning pass): indigo/violet darkened for more tonal
  // richness at rest. Mauve/coral/peach unchanged — only the cool anchor moved.
  vec3 c0 = vec3(0.1448, 0.1364, 0.3036); // muted indigo, deepened
  vec3 c1 = vec3(0.2970, 0.2336, 0.4064); // dusty violet, deepened
  vec3 c2 = vec3(0.6160, 0.4240, 0.5456); // mauve
  vec3 c3 = vec3(0.7948, 0.4976, 0.4452); // muted coral
  vec3 c4 = vec3(0.9240, 0.7876, 0.6760); // soft peach
  t = clamp(t, 0.0, 1.0);
  // Non-uniform stops (tuning pass): the ramp itself now devotes most of its
  // input range to the cool end, independent of the activity-mapping
  // thresholds below — two separate, complementary levers so "mostly cool at
  // rest" is robust rather than resting on one fragile threshold value.
  // Final calibration pass: indigo→violet widened (0.55→0.68) and the
  // violet→mauve band narrowed (width 0.23→0.17) — mauve still appears at
  // the same activity level it always could, it just now takes a further
  // push past a longer cool stretch to reach it.
  //   indigo → violet : t in [0.00, 0.68]  — dominant + major secondary
  //   violet → mauve   : t in [0.68, 0.85]  — transitional activity
  //   mauve  → coral   : t in [0.85, 0.95]  — localized higher activity
  //   coral  → peach   : t in [0.95, 1.00]  — small peak highlights only
  if (t < 0.68) return mix(c0, c1, t / 0.68);
  if (t < 0.85) return mix(c1, c2, (t - 0.68) / 0.17);
  if (t < 0.95) return mix(c2, c3, (t - 0.85) / 0.10);
  return mix(c3, c4, (t - 0.95) / 0.05);
}

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard; // circular sprite; discard also skips the depth write outside it

  float edge = smoothstep(0.5, 0.15, d) * vOpacityJitter;

  // Activity: the SAME deformation field that shapes the body (vField, from
  // Phase 1) also drives color here — bulges/active regions read warm, calm
  // valleys read cool. Not a static XYZ gradient: vField is itself a function
  // of position AND the continuously-drifting noise field, so the warm
  // regions travel and evolve exactly like the deformation does.
  float rawActivity = smoothstep(uActivityFieldLow, uActivityFieldHigh, vField);
  float activity = clamp(pow(rawActivity, uActivityBias) + uActivityIntensity, 0.0, 1.0);
  vec3 rampColor = activityRamp(activity);

  // Depth: front/rear brightness falloff from Phase 1's facing signal.
  // Rear stays dim, not black — the body must still read as one complete
  // volumetric object, not a lit hemisphere.
  float facing01 = clamp(vFacing * 0.5 + 0.5, 0.0, 1.0);
  float depthFactor = mix(uRearDarken, uFrontBoost, facing01);
  vec3 shaded = rampColor * depthFactor;

  // Localized highlight: only the hottest, most front-facing particles
  // approach the soft peach/near-white tone — cubic falloff keeps it rare
  // rather than washing the whole front hemisphere.
  // Tuning pass: window tightened (0.35→0.9 was blending highlight over far
  // too much of the front hemisphere) and its max contribution capped lower
  // (uHighlightStrength 0.5→0.35 below) so even a fully-triggered highlight
  // only partially blends — small concentrations, never a whited-out lobe.
  float hi = smoothstep(0.55, 0.97, pow(activity, 3.0) * facing01) * uHighlightStrength;
  vec3 color = mix(shaded, uHighlightColor, hi);

  gl_FragColor = vec4(color, edge * uOpacity);
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
    () => buildFibonacciSphere(particleCount),
    [particleCount]
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: params.radius },
      uFreqA: { value: params.freqA },
      uAmpA: { value: params.ampA },
      uDriftA: { value: new THREE.Vector3(...params.driftA) },
      uFreqB: { value: params.freqB },
      uAmpB: { value: params.ampB },
      uDriftB: { value: new THREE.Vector3(...params.driftB) },
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Bounding sphere padded past the max possible displaced radius so the
  // single draw call is never frustum-culled early as the body deforms.
  const boundingRadius =
    params.radius + Math.abs(params.ampA) + Math.abs(params.ampB) + 0.5;

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
      u.uFreqB.value = target.freqB;
      u.uAmpB.value = target.ampB;
      (u.uDriftB.value as THREE.Vector3).set(...target.driftB);
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
          {params.bloomEnabled && (
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
