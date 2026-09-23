"use client";

/**
 * AgentActivityDevPanel — Phase 5: temporary development-only agent-activity
 * testing UI. Same safe pattern as JarvisDevPanel (Phase 4): portaled
 * directly into document.body so it cannot inherit a transformed ancestor's
 * trapped stacking context (the exact bug that broke some Phase 4 buttons).
 *
 * Calls ONLY the public AgentActivityController surface — the same one node
 * clicks and (later) backend events use. Isolated, removable: delete this
 * file's import + one JSX line in ApexWorld.tsx to remove it entirely.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AGENT_IDS, AGENT_REGISTRY, type AgentId } from "./agentRegistry";
import type { AgentActivityController } from "./useAgentActivityController";
import type { AgentActivityStatus } from "./agentActivity";

const STATUS_ACTIONS: { label: string; status: AgentActivityStatus }[] = [
  { label: "Activate", status: "activating" },
  { label: "Working", status: "working" },
  { label: "Return", status: "returning" },
  { label: "Complete", status: "complete" },
  { label: "Error", status: "error" },
];

export default function AgentActivityDevPanel({ controller }: { controller: AgentActivityController }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [selected, setSelected] = useState<AgentId>("researcher");

  const runMulti = (ids: AgentId[]) => {
    ids.forEach((id, i) => setTimeout(() => controller.activate(id), i * 120));
    ids.forEach((id, i) => setTimeout(() => controller.setWorking(id), 900 + i * 120));
  };

  const runMixed = () => {
    controller.setWorking("researcher");
    controller.returnResult("memory");
    controller.activate("design");
  };

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 9999,
        pointerEvents: "auto",
        background: "rgba(8,12,18,0.9)",
        border: "1px solid rgba(60,180,200,0.35)",
        borderRadius: 10,
        padding: "10px 12px",
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: 11,
        color: "#bfe6ea",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 230,
        userSelect: "none",
        maxHeight: "70vh",
        overflowY: "auto",
      }}
    >
      <div style={{ opacity: 0.55, letterSpacing: "0.1em", fontSize: 9, textTransform: "uppercase" }}>
        Agent activity dev (Phase 5)
      </div>

      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value as AgentId)}
        style={{
          background: "rgba(255,255,255,0.06)",
          color: "#bfe6ea",
          border: "1px solid rgba(60,180,200,0.3)",
          borderRadius: 5,
          padding: "4px 6px",
          fontFamily: "inherit",
          fontSize: 10.5,
        }}
      >
        {AGENT_IDS.map((id) => {
          const status = controller.getStatus(id);
          return (
            <option key={id} value={id}>
              {AGENT_REGISTRY[id].label} — {status}
            </option>
          );
        })}
      </select>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        {STATUS_ACTIONS.map((a) => (
          <button
            key={a.status}
            onClick={() => controller.setActivity(selected, a.status)}
            style={{
              padding: "5px 6px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 10.5,
              fontFamily: "inherit",
              border: "1px solid rgba(60,180,200,0.3)",
              background: controller.getStatus(selected) === a.status ? "rgba(60,180,200,0.22)" : "transparent",
              color: "#bfe6ea",
            }}
          >
            {a.label}
          </button>
        ))}
        <button
          onClick={() => controller.reset(selected)}
          style={{
            padding: "5px 6px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontFamily: "inherit",
            border: "1px solid rgba(150,150,150,0.3)", background: "transparent", color: "#bfe6ea",
          }}
        >
          Reset
        </button>
        <button
          onClick={() => controller.resetAll()}
          style={{
            padding: "5px 6px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontFamily: "inherit",
            border: "1px solid rgba(150,150,150,0.3)", background: "transparent", color: "#bfe6ea",
          }}
        >
          Reset all
        </button>
      </div>

      <div style={{ opacity: 0.55, letterSpacing: "0.08em", fontSize: 9, textTransform: "uppercase", marginTop: 4 }}>
        Multi-agent tests
      </div>
      <button
        onClick={() => runMulti(["researcher"])}
        style={btnStyle}
      >
        Researcher working
      </button>
      <button
        onClick={() => runMulti(["researcher", "memory"])}
        style={btnStyle}
      >
        Researcher + Memory working
      </button>
      <button
        onClick={() => runMulti(["researcher", "memory", "design"])}
        style={btnStyle}
      >
        Researcher + Memory + Design working
      </button>
      <button onClick={runMixed} style={btnStyle}>
        Mixed: Researcher working, Memory returning, Design activating
      </button>
    </div>,
    document.body
  );
}

const btnStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 10,
  fontFamily: "inherit",
  border: "1px solid rgba(60,180,200,0.3)",
  background: "transparent",
  color: "#bfe6ea",
  textAlign: "left",
};
