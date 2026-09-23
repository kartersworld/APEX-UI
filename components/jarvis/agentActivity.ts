/**
 * agentActivity.ts — Phase 5: the agent activity vocabulary.
 *
 * AgentActivity is deliberately INDEPENDENT from JarvisState (jarvisState.ts):
 *   JarvisState  = what JARVIS itself is doing (one value, the whole entity).
 *   AgentActivity = what each specialized capability is doing (one value PER
 *                   agent, many can be non-idle at once).
 * These must never be collapsed into one state machine — JARVIS may sit in
 * a single high-level state (e.g. "thinking") while several agents run
 * different, independently-timed operations underneath it.
 *
 * `queued` is deliberately NOT included yet — it belongs to a future
 * orchestration/scheduler layer this phase doesn't build.
 */
import type { AgentId } from "./agentRegistry";

export type AgentActivityStatus =
  | "idle"
  | "activating"
  | "working"
  | "returning"
  | "complete"
  | "error";

export type AgentActivityRecord = {
  status: AgentActivityStatus;
  /** ms timestamp (performance.now()-based) this status began — for future duration/timeout logic. */
  since: number;
};

export type AgentActivityMap = Record<AgentId, AgentActivityRecord>;

export function idleRecord(since: number = typeof performance !== "undefined" ? performance.now() : Date.now()): AgentActivityRecord {
  return { status: "idle", since };
}
