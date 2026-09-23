"use client";

/**
 * JarvisDevPanel — Phase 3: temporary development-only state testing UI.
 * Phase 4: added a small live "elapsed in state" readout so transition
 * timing can be judged without instrumenting anything else — not a UI
 * expansion, just one ticking text line.
 *
 * Calls ONLY the public JarvisController surface (setState / requestListening
 * / endListening / setSpeechAmplitude) — the exact same functions a future
 * Phase 7 backend bridge will call. Nothing here reaches into JarvisCore3D,
 * shader uniforms, or jarvisState.ts's profile table directly, so this panel
 * validates the real control surface rather than a special test-only path.
 *
 * Isolated by construction: it is a single self-contained component, mounted
 * only where explicitly included (see ApexHeroOrb.tsx, gated behind
 * `process.env.NODE_ENV !== "production"`), with its own fixed-position
 * overlay and no shared state with the surrounding dashboard. Deleting the
 * import + one JSX line in ApexHeroOrb.tsx fully removes it.
 *
 * VALIDATION FIX (post-Phase 4): rendered through a portal directly into
 * document.body. ApexHeroOrb is mounted inside ApexWorld's core-positioning
 * wrapper, which is `position: absolute` with a CSS `transform` (it centers/
 * translates the core) and `z-index: 3`. A `transform` on an ancestor makes
 * it the containing block for any `position: fixed` descendant AND traps
 * that descendant's stacking context — so this panel's own `z-index: 9999`
 * only ever won locally; the whole subtree was then compared to the rest of
 * the page at the ancestor's `z-index: 3`, which loses to ApexWorld's
 * central "tap to energize" disc (`z-index: 4`) for any button whose screen
 * position happened to fall under that disc's circular hit area — exactly
 * why only SOME buttons failed, and why the failing set differed by
 * viewport size. Portaling to document.body escapes that ancestor entirely,
 * which is the standard fix for this class of bug and touches nothing about
 * how the panel talks to the controller.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { JARVIS_STATES, type JarvisState } from "./jarvisState";
import type { JarvisController } from "./useJarvisController";

const LABEL: Record<JarvisState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  researching: "Researching",
  acting: "Acting",
  speaking: "Speaking",
  complete: "Complete",
  error: "Error",
};

export default function JarvisDevPanel({ controller }: { controller: JarvisController }) {
  const { state, stateEnteredAt, speechAmplitude, setState, requestListening, endListening, setSpeechAmplitude } =
    controller;

  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, []);
  const elapsedS = Math.max(0, (now - stateEnteredAt) / 1000);

  // Portal target must only be touched client-side (document is undefined
  // during SSR/the initial "use client" server render pass).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Exercises the real priority-interrupt path (requestListening/endListening)
  // for the Listening button, and the ordinary setState path for the rest —
  // except while Listening is active, where any other button is routed
  // through endListening(next) so it demonstrates "hand off to a specific
  // next state" rather than a plain override.
  const pick = (s: JarvisState) => {
    if (s === "listening") {
      if (state === "listening") endListening();
      else requestListening();
      return;
    }
    if (state === "listening") {
      endListening(s);
      return;
    }
    setState(s);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 9999,
        pointerEvents: "auto",
        background: "rgba(10,8,20,0.88)",
        border: "1px solid rgba(150,140,200,0.35)",
        borderRadius: 10,
        padding: "10px 12px",
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: 11,
        color: "#cfc8e8",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 196,
        userSelect: "none",
      }}
    >
      <div style={{ opacity: 0.55, letterSpacing: "0.1em", fontSize: 9, textTransform: "uppercase" }}>
        JARVIS dev · state (Phase 4)
      </div>
      <div style={{ opacity: 0.45, fontSize: 9.5 }}>
        active: {LABEL[state]} · {elapsedS.toFixed(1)}s
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        {JARVIS_STATES.map((s) => {
          const active = s === state;
          return (
            <button
              key={s}
              onClick={() => pick(s)}
              style={{
                padding: "5px 6px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 10.5,
                fontFamily: "inherit",
                border: active ? "1px solid #cfc8e8" : "1px solid rgba(150,140,200,0.25)",
                background: active ? "rgba(150,140,200,0.22)" : "transparent",
                color: active ? "#ffffff" : "#cfc8e8",
              }}
            >
              {LABEL[s]}
            </button>
          );
        })}
      </div>

      {state === "speaking" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
          <span style={{ opacity: 0.7 }}>speech amplitude · {speechAmplitude.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={speechAmplitude}
            onChange={(e) => setSpeechAmplitude(parseFloat(e.target.value))}
          />
        </label>
      )}

      {state === "complete" && (
        <div style={{ opacity: 0.55, fontSize: 9.5 }}>transient — auto-returns to Idle</div>
      )}
    </div>,
    document.body
  );
}
