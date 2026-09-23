"use client";

/**
 * useAgentActivityController — Phase 5: the single frontend entry point for
 * agent activity.
 *
 * Owns Record<AgentId, AgentActivityRecord> and exposes plain setters. Like
 * useJarvisController (Phase 3), this hook is pure state — it never touches
 * ReasoningWeb, SVG, or DOM. A consuming component (ApexWorld) passes
 * `activity` as data into <ReasoningWeb activity={...}>, which decides how
 * to animate transitions itself. This mirrors "JarvisCore3D consumes state,
 * doesn't decide business logic" — ReasoningWeb gets the same treatment.
 *
 * MANUAL AND AUTONOMOUS ACTIVITY MUST ENTER THROUGH THIS SAME CONTROLLER:
 * a node click and a future backend `agent.started` event both end up
 * calling `activate(id)` (or another method here) — there is no second,
 * parallel state system for manual interaction.
 */
import { useCallback, useMemo, useState } from "react";
import { AGENT_IDS, type AgentId } from "./agentRegistry";
import { idleRecord, type AgentActivityMap, type AgentActivityStatus } from "./agentActivity";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function initialActivity(): AgentActivityMap {
  const t = now();
  const map = {} as AgentActivityMap;
  for (const id of AGENT_IDS) map[id] = idleRecord(t);
  return map;
}

export type AgentActivityController = {
  activity: AgentActivityMap;
  getStatus: (id: AgentId) => AgentActivityStatus;
  /** General-purpose setter — every other method below is a thin wrapper over this. */
  setActivity: (id: AgentId, status: AgentActivityStatus) => void;
  /** Outbound JARVIS → Agent invocation. */
  activate: (id: AgentId) => void;
  /** Persistent, restrained "this agent is actively working" state. */
  setWorking: (id: AgentId) => void;
  /** Inbound Agent → JARVIS — the agent is returning a result. */
  returnResult: (id: AgentId) => void;
  /** Brief completion acknowledgement, then the caller/UI decays it to idle. */
  complete: (id: AgentId) => void;
  setError: (id: AgentId) => void;
  reset: (id: AgentId) => void;
  resetAll: () => void;
};

export function useAgentActivityController(): AgentActivityController {
  const [activity, setActivityMap] = useState<AgentActivityMap>(initialActivity);

  const setActivity = useCallback((id: AgentId, status: AgentActivityStatus) => {
    setActivityMap((prev) => ({ ...prev, [id]: { status, since: now() } }));
  }, []);

  const activate = useCallback((id: AgentId) => setActivity(id, "activating"), [setActivity]);
  const setWorking = useCallback((id: AgentId) => setActivity(id, "working"), [setActivity]);
  const returnResult = useCallback((id: AgentId) => setActivity(id, "returning"), [setActivity]);
  const complete = useCallback((id: AgentId) => setActivity(id, "complete"), [setActivity]);
  const setError = useCallback((id: AgentId) => setActivity(id, "error"), [setActivity]);
  const reset = useCallback((id: AgentId) => setActivity(id, "idle"), [setActivity]);
  const resetAll = useCallback(() => setActivityMap(initialActivity()), []);

  const getStatus = useCallback((id: AgentId) => activity[id]?.status ?? "idle", [activity]);

  return useMemo(
    () => ({ activity, getStatus, setActivity, activate, setWorking, returnResult, complete, setError, reset, resetAll }),
    [activity, getStatus, setActivity, activate, setWorking, returnResult, complete, setError, reset, resetAll]
  );
}
