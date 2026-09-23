/**
 * jarvisEventBridge.ts — Phase 7: the normalized-event pub/sub.
 *
 * A single module-level singleton built on the browser-native EventTarget/
 * CustomEvent — no npm event-emitter dependency. This file is the entire
 * "control/API layer" surface: framework-agnostic, transport-agnostic,
 * stateless, and unaware of React, Three.js, rendering, backend providers,
 * or authorization. Its only job:
 *
 *   normalized external event → subscription → (the caller decides what to do)
 *
 * It does NOT decide what an event means — useJarvisEventBridge.ts owns the
 * event → controller mapping. This file would be identical whether the
 * eventual backend speaks WebSocket, SSE, HTTP polling, or local IPC: none
 * of that is visible here, by design.
 *
 * OUTPUT-ONLY, by construction: there is an `emit` and a `subscribe`, and
 * nothing else. No method here can execute a tool, grant a permission, or
 * send anything back toward a backend — this bridge cannot become a reverse
 * command channel because it has no concept of "backend" at all, only
 * "whoever calls emit()".
 */
import type { JarvisExternalEvent } from "./jarvisEvents";

const EVENT_NAME = "jarvis-bridge-event";

class JarvisEventBridgeImpl extends EventTarget {
  /** Callable from anywhere — a transport adapter, the dev console, a test script. */
  emit(event: JarvisExternalEvent): void {
    this.dispatchEvent(new CustomEvent<JarvisExternalEvent>(EVENT_NAME, { detail: event }));
  }

  /** Returns an unsubscribe function. */
  subscribe(handler: (event: JarvisExternalEvent) => void): () => void {
    const listener = (e: Event) => handler((e as CustomEvent<JarvisExternalEvent>).detail);
    this.addEventListener(EVENT_NAME, listener);
    return () => this.removeEventListener(EVENT_NAME, listener);
  }
}

export type JarvisEventBridge = JarvisEventBridgeImpl;

// One instance, module-scoped — not a React context, not tied to any
// component's lifetime. Importing this file anywhere (a component, a plain
// script, a test) gets the same bridge.
export const jarvisEventBridge: JarvisEventBridge = new JarvisEventBridgeImpl();
