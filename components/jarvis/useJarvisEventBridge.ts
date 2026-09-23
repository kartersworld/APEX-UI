"use client";

/**
 * useJarvisEventBridge — Phase 7: the ONLY place normalized external events
 * are translated into calls on the existing, protected controllers.
 *
 * This is intentionally a thin switch statement, not a new state system:
 * every branch below calls a method that ALSO already exists on
 * useJarvisController/useAgentActivityController and is ALSO already called
 * by JarvisDevPanel/AgentActivityDevPanel. Manual dev-panel clicks and
 * future real backend events terminate at the exact same controller
 * instances — "one state model, multiple input sources."
 *
 * Stale-event guard (agent events only, per the approved architecture):
 * tracks the last ACCEPTED event's own origin timestamp per agentId, in a
 * ref local to this hook — not by reading back AgentActivityRecord.since
 * (which is stamped at receipt time inside the protected
 * useAgentActivityController.ts, a different clock than event-origin time).
 * Comparing an event's timestamp only against other real event timestamps
 * keeps the guard meaningful regardless of processing latency.
 */
import { useEffect, useRef } from "react";
import type { JarvisController } from "./useJarvisController";
import type { AgentActivityController } from "./useAgentActivityController";
import type { AgentId } from "./agentRegistry";
import { jarvisEventBridge } from "./jarvisEventBridge";
import { isAgentEvent, type JarvisExternalEvent } from "./jarvisEvents";

export function useJarvisEventBridge(jarvis: JarvisController, activity: AgentActivityController): void {
  // Refs, not effect dependencies — both controllers return new function
  // identities on every state change; reading through refs keeps this
  // subscription a mount-once effect instead of resubscribing every render.
  const jarvisRef = useRef(jarvis);
  jarvisRef.current = jarvis;
  const activityRef = useRef(activity);
  activityRef.current = activity;

  const lastAgentEventTimestampRef = useRef<Partial<Record<AgentId, number>>>({});

  useEffect(() => {
    const unsubscribe = jarvisEventBridge.subscribe((event: JarvisExternalEvent) => {
      if (isAgentEvent(event)) {
        const lastTs = lastAgentEventTimestampRef.current[event.agentId];
        if (lastTs !== undefined && event.timestamp < lastTs) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[JarvisEventBridge] dropped stale event — incoming timestamp is older than the last accepted event for this agent",
              { type: event.type, agentId: event.agentId, incomingTimestamp: event.timestamp, currentTimestamp: lastTs }
            );
          }
          return; // drop: do not throw, do not alter visual state
        }
        lastAgentEventTimestampRef.current[event.agentId] = event.timestamp;
      }

      const j = jarvisRef.current;
      const a = activityRef.current;

      switch (event.type) {
        case "jarvis.listening.started":
          j.requestListening();
          break;
        case "jarvis.listening.ended":
          j.endListening(event.nextState);
          break;
        case "jarvis.thinking.started":
          j.setState("thinking", event.meta);
          break;
        case "jarvis.researching.started":
          j.setState("researching", event.meta);
          break;
        case "jarvis.acting.started":
          j.setState("acting", event.meta);
          break;
        case "jarvis.speaking.started":
          j.setState("speaking", event.meta);
          break;
        case "jarvis.completed":
          j.setState("complete", event.meta);
          break;
        case "jarvis.error":
          j.setState("error", event.meta);
          break;
        case "agent.activated":
          a.activate(event.agentId);
          break;
        case "agent.working":
          a.setWorking(event.agentId);
          break;
        case "agent.returning":
          a.returnResult(event.agentId);
          break;
        case "agent.completed":
          a.complete(event.agentId);
          break;
        case "agent.error":
          a.setError(event.agentId);
          break;
        case "agent.reset":
          a.reset(event.agentId);
          break;
      }
    });

    // Dev-only global for manual/regression testing — mirrors how the
    // existing dev panels are gated. Never present in a production build;
    // no other file references this global, so it cleanly no-ops away.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __jarvisEventBridge?: typeof jarvisEventBridge }).__jarvisEventBridge = jarvisEventBridge;
    }

    return () => {
      unsubscribe();
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as { __jarvisEventBridge?: typeof jarvisEventBridge }).__jarvisEventBridge;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
