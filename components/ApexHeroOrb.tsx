"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "./apex-orb.css";
import type { JarvisController } from "./jarvis/useJarvisController";

// three/fiber must never SSR
const JarvisCore3D = dynamic(() => import("./JarvisCore3D"), { ssr: false });

// Stage matches the Apex app's on-screen proportions: the ring renders at its
// natural 900×520 and the particle canvas gets ~900px of height, so the awake
// ball (~166px) fills the R=155 ring exactly like in the app. The whole stage
// scales down to fit whatever container the hero gives it.
const STAGE_W = 900;
const STAGE_H = 900;

export default function ApexHeroOrb({
  jarvis,
  onCoreScreenPosition,
}: {
  // Phase 6: the ONE authoritative JarvisState source, owned by ApexWorld and
  // passed down as data — this component no longer instantiates its own
  // controller (it used to, as a second, parallel instance never consumed by
  // anything outside JarvisCore3D; that duplication is exactly what Phase 6
  // retires). ApexHeroOrb only ever renders what it's told.
  jarvis: JarvisController;
  // Phase 5: reports the JARVIS core's true screen-space center (viewport/
  // client coordinates), whenever it's known/changes. This is a plain DOM
  // measurement, not a Three.js projection — JarvisCore3D's camera sits at
  // a fixed [0,0,4.8] looking at a group that never itself translates (only
  // rotates/deforms), so the core's projected origin is ALWAYS exactly the
  // geometric center of its own <Canvas>, which fills this component's own
  // root box (`boxRef`) edge-to-edge. Measuring boxRef's center is therefore
  // equivalent to projecting the 3D origin through the camera, with zero
  // Three.js/JarvisCore3D coupling required.
  onCoreScreenPosition?: (pos: { x: number; y: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [reducedMotion, setReducedMotion] = useState(false);
  // Ref, not a dependency — so the measure effect below can stay a
  // mount-once effect regardless of whether the parent memoizes this prop.
  const onCoreScreenPositionRef = useRef(onCoreScreenPosition);
  onCoreScreenPositionRef.current = onCoreScreenPosition;

  // Motion-sensitive users get a static disc without the particle sim.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      // clientWidth/Height = layout size, immune to the column's framer-motion
      // entrance scale (getBoundingClientRect under-measured mid-animation).
      // Visible art ≈ 520px tall / 560px wide (ring + waves) - fill the column
      // aggressively, up to 1.6× the natural size on large screens.
      setScale(Math.min(1.6, el.clientWidth / 560, el.clientHeight / 540));
      // Phase 5: report the core's screen center alongside the scale
      // measurement — same trigger (ResizeObserver), zero extra cost.
      if (onCoreScreenPositionRef.current) {
        const rect = el.getBoundingClientRect();
        onCoreScreenPositionRef.current({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // ResizeObserver only fires when `el` itself changes SIZE — a pure
    // reposition (ancestor layout shift with no size change) wouldn't
    // trigger it, so also re-measure on window resize for the position
    // report specifically. Cheap, low-frequency, matches the "resize
    // resilience" requirement.
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Phase 6: purely decorative here — the real click target is ApexWorld's
    // own tap-disc (it sits above this at a higher z-index and already owns
    // the interaction; this element never received real pointer events even
    // before this refactor). No click handling lives in this component.
    <div
      ref={boxRef}
      aria-hidden="true"
      style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none", borderRadius: "50%", userSelect: "none" }}
    >
      <div
        data-apex-stage
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {/* Phase 2: the enclosing gold ring is retired from JARVIS's presentation
            per spec (JARVIS has no halo) — ApexOrb.jsx itself is untouched and
            still used nowhere else, confirmed by a full-repo grep before removal.
            JARVIS particle core - contained to this stage instead of full-screen.
            Phase 3/6: driven entirely by the `jarvis` prop (ApexWorld's single
            controller instance); this component has no knowledge of JarvisState
            semantics, only numbers/values it forwards. */}
        {!reducedMotion && (
          <JarvisCore3D
            contained
            params={jarvis.targetParams}
            state={jarvis.state}
            stateEnteredAt={jarvis.stateEnteredAt}
            speechAmplitude={jarvis.speechAmplitude}
          />
        )}
        {/* Reduced-motion fallback: a static (non-animated) disc in JARVIS's
            own palette — no WebGL, no motion, just a fixed presence. */}
        {reducedMotion && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 260,
              height: 260,
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 42% 38%, #5F4E7E 0%, #353267 62%, #241f47 100%)",
            }}
          />
        )}
      </div>
    </div>
  );
}
