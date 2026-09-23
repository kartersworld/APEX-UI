/**
 * jarvisEvents.ts — Phase 7: the canonical normalized external event
 * vocabulary and payload contracts.
 *
 * Pure types only — no runtime code, no React, no controller imports beyond
 * type-only references. This is the shape a future transport adapter (WS/
 * SSE/HTTP/whatever) must normalize backend messages INTO before calling
 * `jarvisEventBridge.emit()`. Nothing here assumes a specific transport or
 * backend provider.
 *
 * Two event families, matching the two independent, protected controllers
 * they drive (see useJarvisEventBridge.ts for the mapping):
 *   - JarvisCoreEvent  → useJarvisController
 *   - AgentEvent       → useAgentActivityController
 *
 * Deliberately excluded (see the Phase 7 architecture report for why):
 *   - jarvis.idle            — the existing lifecycle already resolves to
 *                              idle naturally; no legitimate use yet.
 *   - jarvis.*.ended events  — the next `.started` event already represents
 *                              the transition (JarvisState is one scalar).
 *   - tool.* first-class events — toolId travels as AgentEvent metadata only;
 *                              no independent tool visual model exists yet.
 *   - speech amplitude       — a continuous signal, not a discrete event;
 *                              stays on JarvisController.setSpeechAmplitude().
 */
import type { JarvisState, JarvisStateMeta } from "./jarvisState";
import type { AgentId } from "./agentRegistry";

export type JarvisCoreEventType =
  | "jarvis.listening.started"
  | "jarvis.listening.ended"
  | "jarvis.thinking.started"
  | "jarvis.researching.started"
  | "jarvis.acting.started"
  | "jarvis.speaking.started"
  | "jarvis.completed"
  | "jarvis.error";

export type AgentEventType =
  | "agent.activated"
  | "agent.working"
  | "agent.returning"
  | "agent.completed"
  | "agent.error"
  | "agent.reset";

// Required on every event: ORIGIN time (when the backend says this actually
// happened), not receipt time — the stale-event guard in
// useJarvisEventBridge.ts compares incoming event timestamps against each
// other, not against wall-clock arrival time.
type EventBase = { timestamp: number };

export type JarvisCoreEvent = EventBase & {
  type: JarvisCoreEventType;
  /** Passed through to setState()/endListening() where applicable — Phase 5's reserved agent-affinity metadata, unused by Phase 7 itself. */
  meta?: JarvisStateMeta;
  /** jarvis.listening.ended only: explicit next state. Omit to fall back to whatever Listening interrupted (useJarvisController's existing default). */
  nextState?: JarvisState;
};

export type AgentEvent = EventBase & {
  type: AgentEventType;
  agentId: AgentId;
  // Optional passthrough — NOT read by the visual/control layer today.
  // Carried so a future task/history/logging system doesn't need a payload
  // version bump when it arrives. This is the concrete split between
  // "information required for visual state control" (type, timestamp,
  // agentId) and "information that belongs to future systems" (everything
  // below).
  taskId?: string;
  toolId?: string;
  requestId?: string;
  progress?: number;
  message?: string;
  error?: { message: string; code?: string };
  metadata?: Record<string, unknown>;
};

export type JarvisExternalEvent = JarvisCoreEvent | AgentEvent;

export function isAgentEvent(event: JarvisExternalEvent): event is AgentEvent {
  return event.type.startsWith("agent.");
}
