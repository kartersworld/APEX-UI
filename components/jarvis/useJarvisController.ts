"use client";

/**
 * useJarvisController — Phase 3 state ownership, Phase 4 motion timing hook.
 *
 * Data flow (per the approved architecture):
 *
 *   jarvisState.ts (definitions + target profiles)
 *     → useJarvisController (THIS FILE: owns the authoritative JarvisState,
 *       priority-interrupt logic, the transient Complete→Idle timer, WHEN
 *       the state was entered, and the raw speech-amplitude input)
 *     → controller.targetParams / .state / .stateEnteredAt / .speechAmplitude
 *     → <JarvisCore3D params={targetParams} state={state}
 *                      stateEnteredAt={stateEnteredAt}
 *                      speechAmplitude={speechAmplitude} />
 *       → JarvisCore3D's useFrame loop (Phase 4): eases `live` toward
 *         `targetParams` using components/jarvis/motion.ts's per-(state,
 *         parameter) timing, then layers motion.ts's continuous-motion and
 *         transient-envelope overlays on top for display.
 *
 * This hook still never touches Three.js, uniforms, geometry, OR motion
 * math — `targetParams` is just JARVIS_STATE_PROFILES[state], unmodified.
 * All physical behavior (transition speed, continuous motion, the Complete
 * release pulse, the Speaking amplitude response) lives in motion.ts and is
 * applied by the renderer — this file only ever answers "what state are we
 * in, since when, and what's the raw speech signal," which is exactly the
 * surface Phase 7's real backend will eventually drive too.
 *
 * Priority interrupt model (unchanged from Phase 3): Listening gets its own
 * dedicated pair of entry points — requestListening() / endListening() —
 * rather than a generic numeric priority table, for the reasons documented
 * where they're defined below.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JarvisParams } from "../JarvisCore3D";
import { JARVIS_STATE_PROFILES, type JarvisState, type JarvisStateMeta } from "./jarvisState";
import { COMPLETE_HOLD_MS } from "./motion";

export type JarvisController = {
  state: JarvisState;
  meta: JarvisStateMeta;
  /** performance.now() timestamp of the most recent state change — drives Complete's release envelope. */
  stateEnteredAt: number;
  speechAmplitude: number;
  targetParams: Partial<JarvisParams>;
  /** General-purpose forward transition. Always takes effect. */
  setState: (next: JarvisState, meta?: JarvisStateMeta) => void;
  /** Priority interrupt — wins immediately regardless of current state. */
  requestListening: () => void;
  /** Leave Listening for `next`, or back to whatever was interrupted. */
  endListening: (next?: JarvisState) => void;
  setSpeechAmplitude: (value: number) => void;
};

export function useJarvisController(initial: JarvisState = "idle"): JarvisController {
  const [state, setStateRaw] = useState<JarvisState>(initial);
  const [meta, setMeta] = useState<JarvisStateMeta>({});
  const [speechAmplitude, setSpeechAmplitudeRaw] = useState(0);

  // Timestamp the moment `state` actually changes, updated DURING render
  // (the documented React pattern for "derive from a prop/state change with
  // zero lag") rather than in a useEffect, so Complete's envelope starts
  // counting from the exact render that committed the new state, not one
  // frame later.
  const prevStateForTimingRef = useRef<JarvisState>(initial);
  const stateEnteredAtRef = useRef<number>(
    typeof performance !== "undefined" ? performance.now() : Date.now()
  );
  if (prevStateForTimingRef.current !== state) {
    prevStateForTimingRef.current = state;
    stateEnteredAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  // The last non-listening state, kept current by the effect below — this is
  // what endListening() falls back to when no explicit next state is given.
  const previousStateRef = useRef<JarvisState>(initial);
  useEffect(() => {
    if (state !== "listening") previousStateRef.current = state;
  }, [state]);

  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCompleteTimer = useCallback(() => {
    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const setState = useCallback(
    (next: JarvisState, nextMeta: JarvisStateMeta = {}) => {
      clearCompleteTimer();
      setStateRaw(next);
      setMeta(nextMeta);
    },
    [clearCompleteTimer]
  );

  const requestListening = useCallback(() => {
    clearCompleteTimer();
    setStateRaw("listening");
    setMeta({});
  }, [clearCompleteTimer]);

  const endListening = useCallback(
    (next?: JarvisState) => {
      setState(next ?? previousStateRef.current);
    },
    [setState]
  );

  // Complete is transient: auto-return to Idle unless something else
  // (another setState/requestListening call) supersedes it first — either
  // path clears this timer, so there is no obsolete-state race. The hold
  // duration (COMPLETE_HOLD_MS) is imported from motion.ts, the same module
  // that authors the release envelope's attack/decay shape, so the two stay
  // coordinated by construction rather than as two numbers that can drift.
  useEffect(() => {
    if (state !== "complete") return;
    completeTimerRef.current = setTimeout(() => setState("idle"), COMPLETE_HOLD_MS);
    return clearCompleteTimer;
  }, [state, setState, clearCompleteTimer]);

  const setSpeechAmplitude = useCallback((value: number) => {
    setSpeechAmplitudeRaw(Math.max(0, Math.min(1, value)));
  }, []);

  // Phase 4: no per-state branching here anymore — speech modulation moved
  // to motion.ts's getSpeakingModulation, applied by the renderer using a
  // properly-smoothed amplitude. This is just the state's base target.
  const targetParams: Partial<JarvisParams> = JARVIS_STATE_PROFILES[state];

  return {
    state,
    meta,
    stateEnteredAt: stateEnteredAtRef.current,
    speechAmplitude,
    targetParams,
    setState,
    requestListening,
    endListening,
    setSpeechAmplitude,
  };
}
