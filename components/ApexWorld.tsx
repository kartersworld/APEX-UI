"use client";

/**
 * ApexWorld - Karters Dashboard's main screen.
 * Layers: backdrop → clickable JARVIS core → ReasoningWeb (circuit traces,
 * orbit rings, the full asymmetric roster, ambient motes) → OrbStatusBar
 * (equalizer + status cluster at the bottom).
 * Clicking any node opens the AGENT OVERVIEW window.
 *
 * Phase 6: this component now owns the ONE authoritative JarvisState source
 * (`useJarvisController`, moved up from ApexHeroOrb) and derives every
 * ambient dashboard signal from it — the core itself, OrbStatusBar's label,
 * ReasoningWeb's activity level, and the backdrop light-cast. The old
 * disconnected 3-value showState/boost() demo cycle (which drove those same
 * four things from fake data, independent of the real state engine) is
 * retired. There is now exactly one answer to "what is JARVIS doing?".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ApexHeroOrb from "./ApexHeroOrb";
import ReasoningWebJs from "./ReasoningWeb";
import ShaderBackgroundJs from "./ShaderBackground";
import OrbStatusBar from "./OrbStatusBar";
import { AGENT_IDS, AGENT_REGISTRY, type AgentId, type AgentStatus } from "./jarvis/agentRegistry";
import { useAgentActivityController } from "./jarvis/useAgentActivityController";
import type { AgentActivityMap } from "./jarvis/agentActivity";
import AgentActivityDevPanel from "./jarvis/AgentActivityDevPanel";
import { useJarvisController } from "./jarvis/useJarvisController";
import type { JarvisState } from "./jarvis/jarvisState";
import JarvisDevPanel from "./jarvis/JarvisDevPanel";
import { useJarvisEventBridge } from "./jarvis/useJarvisEventBridge";

// Phase 6: JarvisState (8 values) → ReasoningWeb's activity-level vocabulary
// (5 values, unchanged/protected — see ReasoningWeb.jsx's LEVEL map). This is
// a pure mapping, not a new system: ReasoningWeb is consumed as-is.
const REASONING_LEVEL: Record<JarvisState, string> = {
  idle: "standby",
  listening: "listening",
  thinking: "processing",
  researching: "reasoning",
  acting: "reasoning",
  speaking: "speaking",
  complete: "standby",
  error: "processing",
};

export type NodeSel = { name: string; key: string; color: string };

// the copied .jsx defaults onSelect to null, which TS infers as `null | undefined`
const ReasoningWeb = ReasoningWebJs as unknown as React.ComponentType<{
  state?: string; trace?: unknown; mode?: string; coreless?: boolean;
  onSelect?: (n: NodeSel) => void; light?: boolean;
  anchor?: [number, number]; activity?: AgentActivityMap;
}>;
const ShaderBackground = ShaderBackgroundJs as unknown as React.ComponentType<{
  opacity?: number; voiceActive?: boolean; gold?: boolean;
}>;

/* Phase 5: agent identity/geometry/metadata (was this file's local ROSTER +
   INFO, manually kept in sync with ReasoningWeb.jsx's own copy) now comes
   from the one canonical registry. AGENT_IDS preserves the original ROSTER's
   exact order. */

const STATUS_LINE: Record<AgentStatus, { color: string; text: string }> = {
  online: { color: "#34d399", text: "Online - JARVIS routes work to it automatically" },
  standby: { color: "#c9a84c", text: "Standby - in active development" },
  integration: { color: "#7f9bb3", text: "Integration - wired into the core" },
};

/* ── AGENT OVERVIEW window - the site's template (the app opens live cockpits) ── */
export function AgentOverview({ sel, onClose }: { sel: NodeSel; onClose: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number } | null>(null);
  const info = AGENT_REGISTRY[sel.key as AgentId] ?? { role: "Specialist", status: "online" as const, caps: ["Part of the JARVIS core"] };
  const c = sel.color;
  const status = STATUS_LINE[info.status];

  useEffect(() => {
    setPos({ x: Math.max(8, window.innerWidth / 2 - 170), y: Math.max(90, window.innerHeight * 0.16) });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the window when it opens and hand it back on close, so the
  // keyboard does not stay stranded on the agent list behind it.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, [pos]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!pos) return;
    dragRef.current = { sx: e.clientX - pos.x, sy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      if (dragRef.current) setPos({ x: ev.clientX - dragRef.current.sx, y: ev.clientY - dragRef.current.sy });
    };
    const up = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  if (!pos) return null;
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`${sel.name} overview`} style={{
      position: "fixed", left: pos.x, top: pos.y,
      width: "min(340px, 92vw)", zIndex: 60,
      background: "rgba(4,3,12,0.92)",
      backdropFilter: "blur(24px)",
      border: `1px solid ${c}44`,
      borderRadius: 16,
      boxShadow: `0 0 40px ${c}18, 0 8px 32px rgba(0,0,0,0.6)`,
      overflow: "hidden",
    }}>
      {/* header - drag handle */}
      <div onMouseDown={onMouseDown} style={{
        display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
        borderBottom: `1px solid ${c}22`, cursor: "grab", userSelect: "none",
        background: `linear-gradient(135deg, ${c}0a 0%, transparent 100%)`,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%", background: `${c}14`,
          border: `1px solid ${c}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: `0 0 10px ${c}` }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", color: c }}>{sel.name.toUpperCase()}</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{info.role}</div>
        </div>
        <button onClick={onClose} aria-label="Close"
          style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "6px 8px", transition: "color 0.2s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >×</button>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", color: `${c}99`, marginBottom: 8, fontFamily: "var(--font-mono)" }}>WHAT IT HANDLES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {info.caps.map((cap) => (
              <div key={cap} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                <div style={{ width: 3, height: 3, borderRadius: "50%", background: `${c}99`, marginTop: 6, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.55 }}>{cap}</span>
              </div>
            ))}
          </div>
        </div>

        {info.asks && info.asks.length > 0 && (
          <div>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: `${c}99`, marginBottom: 8, fontFamily: "var(--font-mono)" }}>EXAMPLE REQUESTS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {info.asks.map((task) => (
                <span key={task} style={{
                  padding: "4px 10px", background: `${c}0d`, border: `1px solid ${c}2a`,
                  borderRadius: 20, fontSize: 10.5, color: `${c}cc`,
                }}>{task}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 7, borderTop: `1px solid ${c}1a`, paddingTop: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: status.color, boxShadow: `0 0 8px ${status.color}` }} />
          <span style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>{status.text}</span>
        </div>
      </div>
    </div>
  );
}

/* ── The world ── */
export default function ApexWorld() {
  const [selected, setSelected] = useState<NodeSel | null>(null);
  const [reduced, setReduced] = useState(false);

  // Phase 6: the ONE authoritative JarvisState source for the whole
  // dashboard shell — the core, OrbStatusBar, ReasoningWeb's activity level,
  // and the backdrop light-cast all derive from this single instance.
  // Previously ApexHeroOrb owned a second, parallel instance of this same
  // hook (driving only the core) while this component ran an entirely
  // separate 3-value demo cycle (driving everything else) — two disconnected
  // answers to "what is JARVIS doing?". That duplication is retired here.
  const jarvis = useJarvisController("idle");

  // Phase 5: the single frontend entry point for agent activity. Manual
  // clicks below and any future autonomous/backend trigger both go through
  // this same controller — see useAgentActivityController.ts.
  const activity = useAgentActivityController();
  const demoCompleteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { Object.values(demoCompleteTimers.current).forEach(clearTimeout); }, []);

  // Phase 7: subscribes the normalized-event bridge to these SAME two
  // controller instances. External events (future backend) and manual dev-
  // panel clicks now converge on identical controller calls — "one state
  // model, multiple input sources." See useJarvisEventBridge.ts.
  useJarvisEventBridge(jarvis, activity);

  // Phase 5: JARVIS core → ReasoningWeb SVG anchor bridge. `corePos` is the
  // core's true screen-space center (reported by ApexHeroOrb — see its
  // onCoreScreenPosition doc comment for why this needs no Three.js
  // projection code). `networkRef` measures the SAME rect ReasoningWeb's SVG
  // fills (the wrapper below is `position:absolute,inset:0`, identical to
  // this component's own root), so the two are directly comparable. Falls
  // back to `undefined` (ReasoningWeb's own hardcoded AX_DEFAULT/AY_DEFAULT)
  // until the first measurement arrives.
  const networkRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<[number, number] | undefined>(undefined);
  const handleCorePosition = useCallback((pos: { x: number; y: number }) => {
    const el = networkRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const RW_VB_W = 680, RW_VB_H = 480; // must match ReasoningWeb's default viewBox — ApexWorld never overrides it
    const scale = Math.min(rect.width / RW_VB_W, rect.height / RW_VB_H);
    const offsetX = (rect.width - RW_VB_W * scale) / 2;
    const offsetY = (rect.height - RW_VB_H * scale) / 2;
    const vx = (pos.x - rect.left - offsetX) / scale;
    const vy = (pos.y - rect.top - offsetY) / scale;
    setAnchor([vx, vy]);
  }, []);

  // Single entry point for opening an agent, shared by the SVG graph and the
  // hidden accessible list, so both routes behave identically. ALSO routes
  // through the activity controller — a manual click and a future backend
  // `agent.started` event converge on the same activate()/complete() calls.
  // The auto-complete after ~1.4s is explicitly DEMO wiring (a click hasn't
  // actually invoked any real work) — not a rule the canonical architecture
  // depends on; delete this block without touching the controller/registry.
  const openAgent = (n: NodeSel) => {
    setSelected(n);
    const id = n.key as AgentId;
    if (AGENT_REGISTRY[id]) {
      activity.activate(id);
      clearTimeout(demoCompleteTimers.current[id]);
      demoCompleteTimers.current[id] = setTimeout(() => activity.complete(id), 1400);
    }
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Phase 6: real JarvisState → the web's activity level (was the old demo
  // tap-cycle → 3-way ternary; see REASONING_LEVEL above).
  const webState = REASONING_LEVEL[jarvis.state];

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", userSelect: "none" }}>
      {/* backdrop - the app's EXACT stack (Chat.jsx dark mode): base radial page
          gradient, waves at 0.12, the cyan breathing glow behind the orb, and the
          dark moat disc directly behind the particle cloud that makes it pop. */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 95% 88% at 50% 42%, #122c43 0%, #0c1d30 38%, #07111f 72%, #050b14 100%)",
      }} />

      {/* background waves - the app's WebGL shader at the app's opacity */}
      {!reduced && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <ShaderBackground opacity={0.12} voiceActive={jarvis.state === "speaking"} gold={false} />
        </div>
      )}

      {/* cyan LIGHT-CAST - mixBlendMode screen (only ever LIFTS the navy, never
          darkens), brightens while speaking. The app has NO dark moat disc
          in dark mode - that layer is its light-theme "reactor well" only.
          Checkpoint H diagnosis: this was the "blue shaded halo" the project
          owner flagged during state testing. Root cause confirmed (not
          JarvisCore3D/bloom/ShaderBackground) — an always-on ambient wash at
          0.18 baseline behind the Core, independent of JarvisCore3D's own
          Checkpoint H dark-body work. Kept (capability preserved, still
          state-reactive) but baseline/peak both cut substantially — at 0.18
          it was competing with the Core's "dark body first" identity across
          every state, not just visible during Speaking. */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", mixBlendMode: "screen",
        background: `radial-gradient(circle at 50% 42%, rgba(13,210,255,${jarvis.state === "speaking" ? 0.20 : 0.06}) 0%, rgba(13,170,228,0.03) 30%, rgba(8,17,31,0) 62%)`,
        transition: "background 0.6s ease",
      }} />

      {/* the reasoning web - app z-order: web (z13) sits BELOW the orb canvas (z15),
          so the bloom haze washes over the lines near the centre, exactly like the app */}
      {/* ReasoningWeb is a verbatim copy from the Apex app: its 18 agent nodes are
          imperative SVG hit-areas with no tabindex, inside an svg[role=img] that
          collapses the whole graph into a single image. Rather than edit the copy,
          the graph is marked decorative here and the same onSelect path is exposed
          through the equivalent list of real buttons below. */}
      <div ref={networkRef} aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
        <ReasoningWeb
          state={webState}
          mode="full"
          coreless
          onSelect={(n: NodeSel) => { openAgent(n); }}
          anchor={anchor}
          activity={activity.activity}
        />
      </div>

      {/* Keyboard and screen-reader equivalent of the agent graph. */}
      <nav className="visually-hidden" aria-label="JARVIS agents">
        <ul>
          {AGENT_IDS.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => openAgent({ key: id, name: AGENT_REGISTRY[id].label, color: AGENT_REGISTRY[id].color })}>
                {AGENT_REGISTRY[id].label} - {AGENT_REGISTRY[id].role}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* the core - painted ABOVE the web (app order); display-only, the tap target
          is the circular disc below so agent nodes near the ring stay clickable */}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: "min(560px, 58vw)", height: "min(500px, 56vw, 70vh)", transform: "translate(-50%, -50%)", zIndex: 3, pointerEvents: "none" }}>
        <ApexHeroOrb jarvis={jarvis} onCoreScreenPosition={handleCorePosition} />
      </div>

      {/* central tap disc - covers the ring only (nodes orbit outside it).
          Phase 6: real interaction — tap to signal "I'm about to speak"
          (requestListening, the priority interrupt from any state), tap
          again to leave Listening (endListening, back to whatever it
          interrupted). This is the ONE production-shaped stand-in for real
          voice activation until actual mic input exists (Phase 7+). */}
      <div
        role="button"
        tabIndex={0}
        aria-label={jarvis.state === "listening" ? "JARVIS core - listening, tap to stop" : "JARVIS core - tap to talk"}
        onClick={() => (jarvis.state === "listening" ? jarvis.endListening() : jarvis.requestListening())}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (jarvis.state === "listening") jarvis.endListening();
            else jarvis.requestListening();
          }
        }}
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          width: "min(340px, 36vw)", height: "min(340px, 36vw)", borderRadius: "50%",
          zIndex: 4, cursor: "pointer", background: "transparent", border: "none", userSelect: "none",
        }}
      />

      {/* equalizer + status cluster */}
      <OrbStatusBar state={jarvis.state} />

      {selected && <AgentOverview sel={selected} onClose={() => setSelected(null)} />}

      {/* Temporary development-only panels — isolated by construction
          (portaled to document.body) and gated out of production. Delete
          either block + its import to remove it entirely once a real
          control surface (Phase 7) exists. Both consume the same
          controllers production/backend code will eventually drive. */}
      {process.env.NODE_ENV !== "production" && <JarvisDevPanel controller={jarvis} />}
      {process.env.NODE_ENV !== "production" && <AgentActivityDevPanel controller={activity} />}
    </div>
  );
}
