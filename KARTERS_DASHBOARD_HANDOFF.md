# Karters Dashboard — JARVIS AI Command Center
## Project Handoff / Continuation State

**Written by:** Claude (Opus/Sonnet 5), end of the session that implemented Phases 1–7.
**Repository:** `C:\Users\direc\KW Dashboard` (Next.js 15 / React 19 / TypeScript / Three.js via `@react-three/fiber`).
**Status at handoff:** Phase 7 complete and validated. Phase 8 has not started.

---

## 1. PROJECT VISION

This is not a static visual dashboard. The goal is to build **Karters Dashboard** into a JARVIS-style **AI Command Center**, where:

- **JARVIS is the central intelligence** — one persistent entity, not a UI decoration.
- **The animated 3D Core (`JarvisCore3D`) is the visual embodiment of JARVIS** — a real 3D GPU-deformed particle body, not a video/sprite/CSS approximation.
- **Specialized agents** (Researcher, Memory, Strategist, Design, Engineering, etc. — 18 registered) surround and connect to JARVIS through a visual "nervous system" (`ReasoningWeb`).
- Agents can operate **independently and concurrently** — multiple agents can be in different activity states at the same time, unrelated to what JARVIS itself is doing.
- The visual network is meant to **reflect actual AI/backend activity**, not just look busy.
- JARVIS has **eight operational states** (Idle, Listening, Thinking, Researching, Acting, Speaking, Complete, Error) with distinct physical behavior for each.
- **Agent activity has its own independent state system** (`idle/activating/working/returning/complete/error`) — deliberately never merged with JARVIS's own state.
- An **event bridge architecture** now exists so that a real backend/AI system can eventually drive the entire frontend through normalized events, without the frontend needing to know anything about the backend's transport or provider.
- The architecture is meant to support future capability growth — memory, tools, voice, multi-step orchestration, additional agents — **without requiring the visual architecture to be rebuilt**.

**Origin note:** this repository began as a clone of an open-source project called **APEX-UI** (an "autonomous-agent orb + reasoning-graph" reference UI by Ruben Mouradian / Reznikov Engineering, MIT-licensed with an explicit exclusion of the "Apex"/Reznikov name and branding from that license). It has been substantially converted into Karters Dashboard across Phases 1–6. Some internal file/component names (`ApexWorld.tsx`, `ApexHeroOrb.tsx`, `ApexOrb.jsx`, `ApexCore3D.jsx`, `apex-orb.css`) still carry the old name **by deliberate decision** — see §8 and §10.

---

## 2. CRITICAL DESIGN INTENT — READ THIS BEFORE TOUCHING THE CORE

> **THE CURRENT JARVIS CORE VISUAL IS NOT FINAL.**

The existing `JarvisCore3D` is functioning correctly as the **renderer/state-response foundation** — it reacts correctly to all 8 states, blends smoothly, shows activity color, has real depth. That correctness is **not** the same thing as final visual quality, and the current appearance must not be mistaken for the intended final design.

**A dedicated Core visual refinement pass is still required**, targeting approximately:

- **~15,000–25,000 particles/points**, if performance allows (currently 18,000 — likely fine, but not re-validated against a redesigned shader)
- A consistent **radial/spherical lattice** (currently a deterministic Fibonacci sphere — likely stays, but not guaranteed)
- **Organic radial displacement** via animated 3D simplex/Perlin-style noise (currently two layered simplex-noise fields — foundation likely reusable)
- **Slow, evolving, non-looping deformation** — noise-space drift, not `sin(time)` (already the current approach architecturally)
- **Asymmetric bulging lobes**, silhouette reading as a **"soft rounded polygon / thinking organic intelligence"** rather than a perfect sphere
- **Electric cyan/blue** at the exterior/high-displacement regions
- **Warm amber/orange** at the interior/low-displacement/core regions
- **Brighter near-white highlights** at displacement extremes
- Genuine dimensional depth (front/side/rear differentiation)
- Organic, alive-feeling motion
- **Minimal neural characteristics** that become more visible during Thinking/Acting
- Visually alive but **computationally efficient**
- The Core should **visually communicate JARVIS state** at a glance

**This is a meaningfully different color language** than what exists today (Phase 2 implemented a muted indigo→violet→mauve→coral→peach ramp, not cyan/blue-to-amber/orange). Do not assume Phase 2's palette work satisfies this — it does not. Treat §13 below as the authoritative statement of outstanding Core work.

**Why this was deferred:** the project deliberately prioritized locking the *architecture* (geometry pipeline, state engine, motion system, agent network, event bridge) before investing in final visual polish, on the theory that re-skinning a proven engine is far cheaper than re-architecting around a finished skin. This was an explicit, repeated instruction from the project owner across multiple phases ("protect the engine, don't canonize the skin").

---

## 3. ORIGINAL PHASE ROADMAP

| Phase | Objective | Implemented | Status | Key architectural decisions |
|---|---|---|---|---|
| **1 — 3D Core Geometry** | Real structured 3D particle body: distribution, deformation, depth, rotation, silhouette | `JarvisCore3D.tsx` created: deterministic Fibonacci-sphere distribution (18,000 particles), GPU vertex-shader displacement from two layered 3D simplex-noise fields (broad + ridged), stable per-particle identity (index = identity forever) | ✅ Complete | Geometry built imperatively (not JSX bufferGeometry sugar); CPU touches only ~20 uniforms/frame, never particle positions; retired `ApexCore3D.jsx`'s CPU-driven random-fill approach (kept on disk, off render path) |
| **2 — Core Visual System** | Activity-driven color, depth shading, luminosity, bloom | Indigo→violet→mauve→coral→peach 5-stop ramp driven by the *same* deformation field that shapes geometry (`vField`); front/rear depth via `vFacing`; localized highlight; restrained selective bloom (`@react-three/postprocessing`) | ✅ Complete (**but see §2 above — this palette is provisional, not the target cyan/amber language**) | Color reuses Phase 1's noise field rather than being a second system; gold ring (`ApexOrb`) confirmed to have no technical dependency and removed from JARVIS's presentation |
| **3 — JARVIS State Engine** | Canonical 8-state vocabulary, controller, priority interrupt, dev testing | `jarvisState.ts` (vocabulary + target profiles), `useJarvisController.ts` (state ownership, `requestListening`/`endListening` priority interrupt, transient Complete→Idle timer), `JarvisDevPanel.tsx` | ✅ Complete | Listening uses dedicated interrupt entry points rather than a numeric priority table (simpler, deterministic, no "how do you ever leave the top-priority state" problem) |
| **4 — Motion & Transition System** | Per-state/per-parameter transition timing, continuous in-state motion, transient envelopes (Complete, Speaking) | `motion.ts`: `TRANSITION_TAU` (per-state/parameter easing), `getContinuousMotion` (idle breathing, thinking pulses, error jitter, etc.), `getCompleteEnvelope`, `getSpeakingModulation`, `getTiltWobble` | ✅ Complete | Three-way separation: state TARGET (Phase 3) vs. TRANSITION TIMING vs. CONTINUOUS MOTION, kept in separate concerns so none had to be rebuilt for the others |
| **5 — Agent & Network Integration** | Transform the existing node network into JARVIS's functional agent system | `agentRegistry.ts` (canonical `AgentId`/`AgentDefinition`, replacing 3 duplicated definitions), `agentActivity.ts` (6-value vocabulary), `useAgentActivityController.ts`, extended `ReasoningWeb.jsx` with directional (inbound/outbound) particle travel + persistent "working" visual + core-position projection bridge | ✅ Complete | `ReasoningWeb`'s existing `fire()`/particle-stream mechanism was extended, not replaced; AgentActivity deliberately kept independent from JarvisState (`Record<AgentId, ...>`, never a shared state machine) |
| **6 — Karters Dashboard Conversion** | Retire demo-only signals, unify JARVIS state ownership, remove third-party branding/links | Moved `useJarvisController` ownership from `ApexHeroOrb` to `ApexWorld` (single authoritative instance); retired the old 3-value `showState`/`boost()` demo cycle entirely; core tap now calls real `requestListening()`/`endListening()`; removed GitHub link + social-media tiles (pointed to the original template author's real personal accounts); updated page title/metadata to "Karters Dashboard — JARVIS AI Command Center" | ✅ Complete | This was the point where "what is JARVIS doing" became answerable by exactly one source everywhere in the dashboard shell |
| **7 — JARVIS Control/API Layer** | Frontend event bridge so future backend/AI events can drive the same controllers dev panels use | `jarvisEvents.ts` (vocabulary/payload types), `jarvisEventBridge.ts` (native `EventTarget`-based pub/sub singleton), `useJarvisEventBridge.ts` (event→controller mapping + stale-event guard), wired into `ApexWorld.tsx` | ✅ Complete | Bridge is output-only, transport-agnostic, stateless — "one state model, multiple input sources"; stale agent events rejected via per-agent timestamp tracking (not via the controller's own `since`, which is receipt-time, not origin-time) |
| **8 — Performance, QA & Final Polish** | Optimize rendering, establish performance profiles, final production readiness | **NOT STARTED** | ❌ Not started | — |

---

## 4. CURRENT CHECKPOINT

> **PHASE 7 COMPLETE. PHASE 8 HAS NOT STARTED.**

The session ended immediately after Phase 7's implementation report was delivered and approved-pending-review. No Phase 8 code exists. No Phase 8 planning conversation occurred beyond the original 8-phase roadmap's one-line description ("Performance, QA & Final Polish").

**The next coding agent must NOT blindly begin final polish.** It must first:
1. Perform a Phase 8 pre-implementation inspection (see §14–15).
2. Explicitly determine whether the still-pending **JARVIS Core visual refinement pass** (§13) belongs inside Phase 8 or should be its own phase before/after Phase 8 — this was never decided in this session and is an open question for the project owner.
3. Produce a pre-implementation report and get explicit approval before writing any code — this has been the working pattern for every phase in this project and should continue.

---

## 5. CURRENT ARCHITECTURE

### Ownership and data flow

```
ApexWorld.tsx  (owns BOTH controllers — the single source of truth)
  │
  ├── useJarvisController("idle")  → jarvis: JarvisController
  │     ├── state: JarvisState (8 values)
  │     ├── targetParams, stateEnteredAt, speechAmplitude
  │     └── setState / requestListening / endListening / setSpeechAmplitude
  │
  ├── useAgentActivityController()  → activity: AgentActivityController
  │     ├── activity: Record<AgentId, {status, since}>
  │     └── setActivity / activate / setWorking / returnResult / complete / setError / reset / resetAll
  │
  ├── useJarvisEventBridge(jarvis, activity)   ← Phase 7: subscribes external events to the SAME two controllers above
  │
  ├── <ApexHeroOrb jarvis={jarvis} onCoreScreenPosition={...} />
  │     └── <JarvisCore3D params={jarvis.targetParams} state={jarvis.state} .../>   ← pure renderer, no business logic
  │
  ├── <ReasoningWeb state={derivedLevel} anchor={projectedCoreAnchor} activity={activity.activity} onSelect={...} />
  │     └── pure SVG renderer; reacts to `activity` prop, decides its own animation internals
  │
  ├── <OrbStatusBar state={jarvis.state} />   ← label mapped from the real 8-value state
  │
  ├── core tap-disc → jarvis.requestListening() / jarvis.endListening()
  │
  ├── node click → activity.activate(id) [+ demo-only auto-complete after 1.4s — explicitly removable]
  │
  ├── <JarvisDevPanel controller={jarvis} />          (dev-only, portaled to document.body)
  └── <AgentActivityDevPanel controller={activity} /> (dev-only, portaled to document.body)
```

### Key principle, repeated because it matters

**There is exactly ONE authoritative JARVIS state source** (the `useJarvisController` instance owned by `ApexWorld`) and **exactly ONE authoritative agent-activity source** (the `useAgentActivityController` instance, also owned by `ApexWorld`). Every consumer — the 3D renderer, the status bar, the network, the dev panels, and now the event bridge — reads from or writes to these same two instances. **Nothing in this codebase should ever instantiate a second copy of either hook.** This was a real bug fixed in Phase 6 (see §18) and must not regress.

**JarvisState and AgentActivity are deliberately separate systems** — JARVIS can be `thinking` while three agents are independently `working`/`returning`/`activating`, or JARVIS can be in `error` while agents continue unaffected. This was explicitly validated (§7) and must be preserved.

### Component inventory (see §9 for full file-by-file detail)

- **`JarvisCore3D.tsx`** — the 3D renderer. Fibonacci-sphere geometry, GPU vertex/fragment shaders, bloom. Consumes `params`/`state`/`stateEnteredAt`/`speechAmplitude` as plain data; contains zero JarvisState-name business logic.
- **`ApexHeroOrb.tsx`** — thin layout/sizing wrapper around `JarvisCore3D`; owns no state of its own since Phase 6 (accepts `jarvis` as a required prop).
- **`ApexWorld.tsx`** — the dashboard shell; owns both controllers, both dev panels, the event bridge subscription, the core tap interaction, and the ReasoningWeb/core-position projection bridge.
- **`ReasoningWeb.jsx`** — the SVG agent network. Node geometry now sourced from `agentRegistry.ts` (previously duplicated locally). Extended in Phase 5 with directional particle travel and a persistent "working" visual, reusing its pre-existing `fire()`/particle-stream mechanism rather than replacing it.
- **`OrbStatusBar.jsx`** — the bottom equalizer/label cluster; label now mapped from the full 8-value `JarvisState`.
- **Dev panels** (`JarvisDevPanel.tsx`, `AgentActivityDevPanel.tsx`) — manual test surfaces, both portaled directly to `document.body` (a real bug — a transformed ancestor was silently trapping their `position:fixed` stacking context and eating some clicks — was found and fixed in Phase 4; **any future dev-only overlay must use the same portal pattern**).

---

## 6. PHASE 7 EVENT ARCHITECTURE

### Files

- **`components/jarvis/jarvisEvents.ts`** — pure types. `JarvisCoreEventType` (8 values), `AgentEventType` (6 values), `JarvisCoreEvent`/`AgentEvent`/`JarvisExternalEvent` payload shapes, `isAgentEvent()` type guard.
- **`components/jarvis/jarvisEventBridge.ts`** — `jarvisEventBridge`, a module-level singleton built on the browser-native `EventTarget`/`CustomEvent` (no npm event-emitter dependency). Exposes only `emit(event)` and `subscribe(handler)`. Has zero React/Three.js/transport/backend/authorization awareness by design.
- **`components/jarvis/useJarvisEventBridge.ts`** — the *only* place event semantics are interpreted. One `useEffect`, subscribes once, contains the full event→controller switch statement, and implements the stale-event guard. Also exposes `window.__jarvisEventBridge` in non-production builds for manual/regression testing (no third dev panel was created, per explicit instruction).

### Data flow

```
external normalized event (any origin — console, test script, future transport adapter)
  → jarvisEventBridge.emit(event)
    → useJarvisEventBridge's subscription (in ApexWorld)
      → [stale-event guard, agent events only]
      → switch(event.type) → jarvis.setState(...) / jarvis.requestListening() / activity.activate(...) / etc.
        → existing JarvisState / AgentActivityMap
          → existing renderers (JarvisCore3D, OrbStatusBar, ReasoningWeb)
```

### Canonical event vocabulary actually implemented

**JARVIS events** (8): `jarvis.listening.started`, `jarvis.listening.ended`, `jarvis.thinking.started`, `jarvis.researching.started`, `jarvis.acting.started`, `jarvis.speaking.started`, `jarvis.completed`, `jarvis.error`.

**Agent events** (6): `agent.activated`, `agent.working`, `agent.returning`, `agent.completed`, `agent.error`, `agent.reset`.

**Deliberately omitted:** `jarvis.idle` (the lifecycle already resolves to idle naturally — e.g. Complete auto-returns after ~1.6s); separate `*.ended` events for JARVIS states (the next `.started` event already represents the transition, since `JarvisState` is one scalar); first-class `tool.*` visual events (tool activity is metadata/passthrough only — see below).

### Required payload fields

Every event requires `{type, timestamp}`. Agent events additionally require `agentId`. Optional passthrough fields on agent events (`taskId`, `toolId`, `requestId`, `progress`, `message`, `error`, `metadata`) are carried but **read by nothing in the visual layer today** — reserved for a future task/history/logging system without needing a payload version bump.

### Timestamp / stale-event protection

`timestamp` must be **event-origin time**, not receipt time. `useJarvisEventBridge` tracks the last *accepted* event's own timestamp per `agentId` in a local ref (deliberately not read from `AgentActivityRecord.since`, which is receipt-time — a different clock). An incoming agent event older than the last accepted one for that same agent is **dropped silently** (no throw, no visual change) with a `console.warn` identifying `type`, `agentId`, `incomingTimestamp`, `currentTimestamp`. No sequence numbers, queues, or reconciliation — timestamp comparison only, by explicit decision.

### Concurrency

Unaffected by the bridge — `AgentActivityMap` is `Record<AgentId, ...>`, so N agents updating independently is just N independent `setActivity` calls, already proven safe pre-Phase-7.

### Error isolation

`agent.error` → only that agent enters its own `error` activity status. `jarvis.error` → JARVIS's own top-level state becomes `error`. **The bridge never auto-promotes an `agent.error` into a `jarvis.error`** — that judgment (e.g. "3 consecutive agent failures means JARVIS itself is broken") belongs to future backend/orchestration logic, not this frontend layer.

### Transport status

**No transport adapter exists.** Nothing has selected or implemented WebSocket, SSE, HTTP polling, or IPC. The bridge's `emit()` is directly callable from anywhere (a future adapter, the dev console, a test script) and has no opinion on how events reach it. **No AI provider has been chosen or integrated** (not OpenAI, not Anthropic, not a local LLM — nothing).

### Continuous signals — explicitly NOT routed through the bridge

`jarvis.setSpeechAmplitude(value)` (from `useJarvisController`) remains the dedicated interface for continuous, high-frequency signals like real-time audio amplitude. **A future voice/audio implementation must call this directly, not emit dozens of discrete bridge events per second.** This distinction is deliberate and documented in `jarvisEvents.ts`'s own comments — do not "fix" it by adding an amplitude event type.

---

## 7. VALIDATED BEHAVIOR

All of the following were manually verified in-browser during this session (via a combination of real UI clicks and `window.__jarvisEventBridge.emit(...)` calls, per explicit instruction to validate through the bridge rather than only dev-panel clicks):

- All 8 `JarvisState`s reachable and visually distinct: Idle, Listening, Thinking, Researching, Acting, Speaking, Complete (auto-returns to Idle after ~1.6s), Error.
- All 6 `AgentActivity` operations: activate, working, returning, complete, error, reset.
- Multi-agent concurrency: Researcher + Memory + Design independently in three different states simultaneously, confirmed via the dev panel's per-agent dropdown.
- **Stale-event rejection**, tested exactly as specified: `agent.working(memory, t2)` accepted → `agent.activated(memory, t1<t2)` rejected (status stayed `working`, warning logged with all four required fields) → `agent.returning(memory, t3>t2)` accepted.
- Agent errors remain isolated from JARVIS errors: `jarvis.error` set while Researcher/Memory/Design remained independently `working`/`returning`/`activating`, unaffected.
- JARVIS state changing (to `speaking`) while three agents remained active — confirmed no interference either direction.
- Physical core tap → `requestListening()` → visible attentive posture; second tap → `endListening()` → correct fallback state. Verified via real click, not just `emit()`.
- Both dev panels (`JarvisDevPanel`, `AgentActivityDevPanel`) fully functional throughout, including in the same session as bridge-driven events.
- `npx tsc --noEmit` — zero errors, confirmed at the end of Phase 7 and again at the end of this handoff session.
- Zero unexpected console errors. The one `console.warn` from the intentional stale-event test is expected/correct, not a defect.
- FPS: **~78–80fps** measured both at rest and with an active state, consistent with the Phase 6 baseline (~75fps) and the Phase 4/5 baseline (~76–80fps) — no regression from Phase 7.
- **One transient FPS outlier was observed** (a single reading of ~1.1fps) during a rapid, unbroken sequence of automated browser tool calls. Diagnosed as an automation-pane rendering-priority artifact, not a code issue: `setTimeout` timing was normal (103ms for a 100ms request) and `document.hasFocus()` was `true` during the anomaly, ruling out main-thread blocking; a fresh page navigation immediately after read 80fps again. Recorded here for transparency, not because it's believed to reflect a real regression.

---

## 8. PROTECTED ARCHITECTURAL RULES

The next coding agent must preserve these unless the project owner explicitly authorizes a change:

1. **Do not introduce a second JARVIS state system.** `useJarvisController` (owned by `ApexWorld`) is the only one.
2. **Do not introduce a second agent-activity system.** `useAgentActivityController` (owned by `ApexWorld`) is the only one.
3. **Do not couple `AgentActivity` to `JarvisState`.** They must remain independently updatable at all times.
4. **Multi-agent activity must remain independently keyed** (`Record<AgentId, ...>`) — never a single shared "active agent" variable.
5. **Preserve concurrency** — JARVIS and any number of agents must be able to be in unrelated states simultaneously.
6. **Do not rewrite working architecture simply because another implementation seems cleaner.** This has been an explicit, repeated instruction across every phase.
7. **Preserve the event bridge as transport-independent** unless a future phase explicitly chooses and implements a transport adapter — and even then, the adapter should sit *outside* `jarvisEventBridge.ts`, translating into its normalized event shape, not inside it.
8. **Do not make the visual layer responsible for backend business logic** (e.g., deciding that repeated agent failures constitute a JARVIS-level failure — that belongs to a future backend).
9. **Do not allow frontend visual events to become an authorization/execution mechanism.** The bridge is strictly output-only from the backend's perspective; it must never grow a reverse "command" channel without a separately-designed, explicitly-authorized authentication/permission layer.
10. **Preserve the existing state vocabulary** (8 JarvisStates, 6 AgentActivity statuses, the event type names in §6) unless a future phase explicitly changes it with the project owner's approval.
11. **Do not redesign the Core accidentally** while doing unrelated architecture work (e.g., a Phase 8 performance pass should not casually "improve" the shader).
12. **Conversely — do not treat the current Core appearance as final** (§2, §13). These two rules are not in tension: leave the Core alone unless you are *specifically* doing the dedicated visual refinement pass, and don't confuse "don't touch it accidentally" with "it's done."
13. **Do not remove working development controls** (`JarvisDevPanel`, `AgentActivityDevPanel`, the `window.__jarvisEventBridge` dev global) until they are intentionally and explicitly retired by a future phase (likely once a real backend exists).
14. **Maintain the current approximate performance baseline** (~75–80fps in this dev environment) unless a visual improvement has an explicitly accepted cost, agreed with the project owner in advance.

---

## 9. FILE INVENTORY

Verified against the actual repository (not from memory) via `git status`/`git diff --stat` and direct file listing at the end of this session.

### Created during Phases 1–7 (all under `components/jarvis/` unless noted)

| File | Purpose | Active? | Owner/caller | Protection status |
|---|---|---|---|---|
| `components/JarvisCore3D.tsx` | The 3D renderer — geometry, shaders, bloom, motion consumption | Yes | `ApexHeroOrb.tsx` | **Protected** — do not modify except in a dedicated, approved Core visual-refinement or performance pass |
| `jarvisState.ts` | Canonical `JarvisState` type + `JARVIS_STATE_PROFILES` target-parameter table | Yes | `useJarvisController.ts` | **Protected** |
| `motion.ts` | Transition timing, continuous motion, transient envelopes | Yes | `JarvisCore3D.tsx` | **Protected** |
| `useJarvisController.ts` | The JARVIS state controller hook | Yes | `ApexWorld.tsx` (single instance) | **Protected** |
| `JarvisDevPanel.tsx` | Manual JarvisState testing UI, portaled to `document.body` | Yes (dev-only) | `ApexWorld.tsx` | Protected until intentionally retired |
| `agentRegistry.ts` | Canonical `AgentId`/`AgentDefinition`/`AGENT_REGISTRY`/`AGENT_IDS` — single source of truth for all 18 agents (geometry, color, role/caps/status) | Yes | `ReasoningWeb.jsx`, `ApexWorld.tsx` | **Protected** |
| `agentActivity.ts` | `AgentActivityStatus` (6 values) + `AgentActivityRecord`/`AgentActivityMap` types | Yes | `useAgentActivityController.ts` | **Protected** |
| `useAgentActivityController.ts` | The agent-activity controller hook | Yes | `ApexWorld.tsx` (single instance) | **Protected** |
| `AgentActivityDevPanel.tsx` | Manual AgentActivity testing UI, portaled to `document.body` | Yes (dev-only) | `ApexWorld.tsx` | Protected until intentionally retired |
| `jarvisEvents.ts` | Phase 7 event vocabulary + payload types | Yes | `useJarvisEventBridge.ts` | **Protected** |
| `jarvisEventBridge.ts` | Phase 7 pub/sub singleton | Yes | `useJarvisEventBridge.ts`, dev console | **Protected** |
| `useJarvisEventBridge.ts` | Phase 7 event→controller mapping + stale-event guard | Yes | `ApexWorld.tsx` | **Protected** |

### Modified (pre-existing files from the original APEX-UI template)

| File | What changed | Why | Protection status |
|---|---|---|---|
| `components/ApexWorld.tsx` | Retired the old `showState`/`boost()` demo cycle; now owns both controllers + the event bridge subscription; core tap wired to real `requestListening`/`endListening`; derives `OrbStatusBar`/`ReasoningWeb`/backdrop signals from real `JarvisState`; removed GitHub link + social tiles; agent registry consumed instead of local duplicated data | Phase 6: unify "what is JARVIS doing" to one source; Phase 5: agent registry consolidation; Phase 7: event bridge wiring | **Protected** — this is now the dashboard's central integration point |
| `components/ApexHeroOrb.tsx` | Removed its own (redundant, second) `useJarvisController` instance and the dead `OrbState` tap-cycle apparatus; now accepts `jarvis` as a required prop | Phase 6: eliminate the two-controllers bug | **Protected** |
| `components/ReasoningWeb.jsx` | Node data now sourced from `agentRegistry.ts` instead of a local `ROSTER`; extended with directional (`reverse`) particle travel, persistent `working`/`errorFlag` node states, and a second `useEffect` diffing the new `activity` prop | Phase 5: agent network becomes functional, not decorative | **Protected** — the pre-existing `fire()`/particle-stream mechanism and the mount-effect are especially sensitive to changes |
| `components/OrbStatusBar.jsx` | Label mapping extended from 3 values to the full 8-value `JarvisState` | Phase 6 | Protected but low-risk to extend further if a 9th state is ever added |
| `components/ApexOverviewPanel.tsx` | Removed the `TILES` array (Instagram/Facebook/LinkedIn links to the original template author's real personal accounts) and its rendering | Phase 6: branding/link cleanup; those were real third-party personal links, not placeholders | Safe to modify further — this is a fairly cosmetic HUD panel |
| `app/layout.tsx` | Page `<title>`/description updated to "Karters Dashboard — JARVIS AI Command Center" | Phase 6 | Safe to modify further |
| `app/page.tsx` | Removed the "View on GitHub" link to the original template's repo | Phase 6 | Safe to modify further |
| `package.json` | `name`/`description` fields updated | Phase 6 | Safe to modify further |

### Present but NOT modified this project (pre-existing, largely untouched)

| File | Status |
|---|---|
| `components/ApexCore3D.jsx` | **Fully retired** — the old CPU-driven random-particle-fill implementation Phase 1 replaced. Kept on disk as reference/rollback, confirmed via repo-wide grep to have zero remaining imports/callers. Safe to delete eventually, not urgent. |
| `components/ApexOrb.jsx` | **Fully retired** — the old gold-ring SVG component. Zero remaining callers (confirmed by grep before Phase 2 removed its usage). Safe to delete eventually. |
| `components/apex-orb.css` | **Mixed status** — still imported by `ApexHeroOrb.tsx` and genuinely used by `OrbStatusBar.jsx`'s dot-blink/center-ring animations, but also contains a large block of dead rules (`.orb-ring-*`, `.sound-wave`, `.wavebar-*`) left over from the retired `ApexOrb.jsx`. See §10. |
| `components/ShaderBackground.jsx` | Unrelated to JARVIS — the animated backdrop shader, MIT-licensed third-party component (see `CREDITS.md`). Not touched, not relevant to JARVIS work. |
| `app/api/weather/route.ts` | Unrelated to JARVIS — powers the overview panel's weather display. Not touched. |
| `LICENSE`, `CREDITS.md` | **Legal attribution — must not be removed or altered** in a way that violates the license. These are separate from product branding (see §10). |
| `README.md` | **Stale** — still describes the project as "APEX-UI." Not updated during Phases 1–7 (deliberately deferred as documentation, not runtime-visible product identity). See §10. |

---

## 10. KNOWN TECHNICAL DEBT / DEFERRED ITEMS

### Safe to clean up later (low risk, no architectural implications)

- `README.md` still describes the project as "APEX-UI" and documents the old component names/props. Purely documentation, not rendered to any user.
- `apex-orb.css` contains dead rules (`.orb-ring-slow/medium/fast`, `.orb-orbit-cw/ccw`, `.sound-wave`, `.wavebar-*`) left over from the retired `ApexOrb.jsx` ring. The *live* rules in the same file (`.orb-dot-blink`, `.blink-0/1/2`, `.orb-center-ring`, `.orb-center`) are still used by `OrbStatusBar.jsx` and must be kept.
- Internal filenames `ApexWorld.tsx`, `ApexHeroOrb.tsx`, `ApexOrb.jsx`, `ApexCore3D.jsx`, `apex-orb.css` still carry the old product name. Explicitly decided (Phase 6) to leave these alone for now — renaming them is a large-diff, import-touching refactor with purely cosmetic benefit, deferred as a controlled future cleanup if ever wanted.
- `favicon`/app icon: **no custom favicon exists** — the app currently uses whatever Next.js's default is. Never addressed; low priority, but genuinely outstanding if a polished favicon is wanted eventually.
- The overview HUD's social-link area (`ApexOverviewPanel.tsx`) now opens to an empty space below the clock (tiles were removed, not replaced). Whenever real Karters Dashboard links exist, decide whether that space is reused or the toggle affordance is removed entirely.

### Architectural work still required (not just cleanup)

- **The dedicated JARVIS Core visual refinement pass (§2, §13) — this is the single largest piece of outstanding work in the project.**
- **No transport adapter exists** for the Phase 7 event bridge — WebSocket/SSE/HTTP/IPC, all unbuilt, all unselected.
- **No AI/backend orchestration exists** — no LLM integration, no agent execution, no tool-calling.
- **No persistent memory/storage system exists.**
- **No voice/audio pipeline exists** (though `setSpeechAmplitude` is ready to receive one).
- **No authentication/authorization system exists** — relevant the moment any real backend-triggering UI is considered (the current dev panels only ever drive *visual* state, never real actions, by design — see Protected Rule 9).
- **No production command channel exists** and none should be built without a deliberate, separately-scoped security design.

---

## 11. DO NOT CONFUSE THESE SYSTEMS

| Layer | Responsibility | Does NOT do |
|---|---|---|
| **JARVIS state** (`useJarvisController`, `jarvisState.ts`) | What JARVIS itself is doing — one scalar value for the whole entity | Does not track individual agents |
| **Agent activity** (`useAgentActivityController`, `agentActivity.ts`) | What each of the 18 specialized agents is independently doing | Does not represent JARVIS's own high-level state |
| **Event bridge** (`jarvisEventBridge.ts`, `useJarvisEventBridge.ts`) | Translates normalized external events into calls on the two controllers above | Does not decide business logic, does not talk to any transport, does not authorize anything |
| **Future transport adapter** (not built) | Would translate a specific transport's raw messages (WS/SSE/HTTP/IPC) into the bridge's normalized event shape | Would not itself touch React state or the controllers directly — always goes through the bridge |
| **Future AI/backend orchestration** (not built) | Would decide what JARVIS/agents should actually do, run real tools, manage real tasks | Is not, and must never become, something the frontend visual layer implements |
| **Visual renderer** (`JarvisCore3D.tsx`, `ReasoningWeb.jsx`, `OrbStatusBar.jsx`) | Displays whatever the controllers currently say | Contains no business logic, no state-name-aware branching beyond "what number do I show" |

These layers are intentionally separated so that any one of them (especially the still-unbuilt backend/transport layers) can be built or changed later without requiring changes to the others.

---

## 12. FUTURE BACKEND INTEGRATION

### Prepared (exists, tested, ready to be driven)

- Normalized event vocabulary (§6) — 8 JARVIS events, 6 agent events
- `jarvisEventBridge` — the pub/sub entry point, `emit()` callable from anywhere
- Full controller integration — events reach the exact same controllers manual dev panels use
- Concurrent, independently-keyed agent state
- JARVIS's full 8-state response system, with smooth per-state/per-parameter motion

### NOT yet selected or built — do not assume any of these have been decided

- The actual LLM/AI backend (no provider chosen — not OpenAI, not Anthropic, not local)
- Any orchestrator/agent-execution framework
- WebSocket / SSE / HTTP polling / IPC transport — **none implemented, none chosen**
- Tool execution architecture (tool activity is metadata-only today, §6)
- Persistent memory/storage
- Voice pipeline (STT/TTS) — `setSpeechAmplitude` is the ready hook, nothing upstream of it exists
- Authentication/authorization
- Any production command channel

**Do not invent decisions in any of the above categories.** If Phase 8 or a later phase needs one of these, it needs a dedicated pre-implementation discussion with the project owner first, the same way every phase in this project has worked.

---

## 13. CORE VISUAL REFINEMENT — OUTSTANDING (PROMINENT REMINDER)

> **This section exists because it is easy to forget once a system "works."**

After the foundational architecture (Phases 1–7) is confirmed stable, the project still needs a **dedicated pass specifically on `JarvisCore3D.tsx`** to bring its visual design in line with the target described in §2: an abstract living/thinking intelligence built from a structured particle sphere, with asymmetric organic lobes, a cyan/blue-to-amber/orange activity language, near-white highlight peaks at displacement extremes, and genuine dimensional depth.

**Functional correctness and final visual quality are two separate acceptance criteria.** The Core correctly changing shape/color/motion per state (validated, §7) does **not** mean its appearance is approved or finished. Do not let "it reacts correctly" be mistaken for "it looks right." The next agent — whether working on Phase 8 or this dedicated pass — must treat this as still open until the project owner explicitly signs off on the Core's visual design.

---

## 14. PHASE 8 ENTRY CONDITIONS

Before writing any Phase 8 code, the next coding agent must:

1. Read this entire handoff document.
2. Inspect the actual repository (do not trust this document blindly — see §16).
3. Confirm the actual architecture still matches what's described here.
4. Run `npx tsc --noEmit` and confirm current type-check status.
5. Identify the current runtime state (does the dev server start cleanly, any console errors, current FPS).
6. Review the outstanding technical debt (§10).
7. Determine the original Phase 8 scope ("Performance, QA & Final Polish" per the roadmap — but verify this is still what the project owner wants before assuming).
8. **Explicitly account for the unfinished JARVIS Core visual pass (§13)** — decide, or ask, whether it's part of Phase 8 or a separate phase.
9. Produce a **PRE-IMPLEMENTATION REPORT** (see §15 for required contents).
10. **STOP and wait for explicit user approval before modifying any source code.**

Do not immediately begin writing Phase 8 code. Every phase in this project so far has followed inspect → report → wait for approval → implement → validate → report. Continue that pattern.

---

## 15. PHASE 8 PRE-IMPLEMENTATION REPORT REQUIREMENTS

The report should explain:

- What Phase 8 should accomplish, concretely
- What files it proposes touching, and why
- What files/systems it will explicitly protect (start from §8's list)
- Whether Core visual refinement belongs inside Phase 8 or should become its own dedicated phase
- Remaining technical debt (cross-reference §10, verified fresh against the repo)
- Regression risks
- Performance risks
- What should be cleaned up now versus deferred further
- An exact testing/validation plan
- Any decisions that require the project owner's explicit approval before implementation

---

## 16. HANDOFF INSTRUCTIONS FOR THE NEXT AI CODING AGENT

> **Do not assume this Markdown file is perfectly current merely because it exists.** Treat it as the project's handoff and architectural intent, then **verify it against the repository** before making changes. **Repository reality wins for implementation details; this document wins for user intent and protected design decisions**, unless the project owner explicitly changes them in a later conversation.

> **DO NOT IMPLEMENT ANYTHING UNTIL THE USER APPROVES YOUR PHASE 8 PRE-IMPLEMENTATION REPORT.**

---

## 17. CURRENT REPOSITORY HEALTH (captured at handoff time)

- **Type-check:** `npx tsc --noEmit` → clean, zero errors.
- **Git status:** on branch `main`, up to date with `origin/main` (origin still points at the original `RubenM1990/APEX-UI` template repo — this working copy has never been pushed anywhere else). Modified (not yet committed): `app/layout.tsx`, `app/page.tsx`, `components/ApexHeroOrb.tsx`, `components/ApexOverviewPanel.tsx`, `components/ApexWorld.tsx`, `components/OrbStatusBar.jsx`, `components/ReasoningWeb.jsx`, `package.json`. Untracked (new): `components/JarvisCore3D.tsx`, `components/jarvis/` (11 files), `.claude/` (tooling config, not application code), and this handoff file itself.
- **Dev server:** running at `http://localhost:3000` at the time of this handoff (`npm run dev`, via the project's `.claude/launch.json`).
- **Console errors:** none unexpected. The one intentional `console.warn` from the stale-event regression test is expected behavior, not a defect.
- **FPS:** ~78–80fps at rest and under active state, consistent with the established ~75–80fps baseline across Phases 4–7. (One transient automation-artifact outlier recorded and explained in §7 — not believed to reflect real performance.)
- **Last validated functional state:** full regression suite (§7) passed immediately before this handoff document was written. The dashboard was left resting at `JarvisState = idle` with all agent activity reset to `idle`.

---

## 18. SESSION HISTORY / DECISION LOG

Chronological, focused on **why**, not just what — so a "cleaner" reimplementation doesn't accidentally erase intentional decisions.

- **Phase 1:** Chose a deterministic Fibonacci (golden-angle) sphere over a random particle fill specifically so every particle has a **stable identity** (its array index) forever — this was a prerequisite for every later phase that needed to reference "this particular particle" or region consistently (color masks, agent affinity, etc.). Chose GPU vertex-shader displacement over CPU position updates specifically for performance headroom, since the roadmap always intended 8 states × motion × color × bloom to eventually run concurrently.
- **Phase 2:** Colored particles using the *same* noise field that deforms them (`vField`), rather than a separate color system, specifically so later phases could shift "activity" and have shape and color move together automatically. The indigo→violet→mauve→coral→peach palette went through several tuning passes (the first attempts read as "too pale/washed out" and "too pink" — corrected via a non-uniform ramp that devotes more of its range to the cool end) — **this palette is explicitly non-final** per §2/§13.
- **Phase 3:** Chose dedicated `requestListening()`/`endListening()` functions over a generic numeric priority system for the "Listening interrupts everything" requirement, because a pure priority-number scheme has no clean answer for "how does anything ever leave the highest-priority state" — the dedicated-pair approach sidesteps that problem entirely and stayed simple.
- **Phase 4:** Separated state TARGET / transition TIMING / continuous MOTION into three concerns specifically so later tuning of "how fast does X happen" never required touching "what X even is."
- **Phase 5:** Chose to **extend** `ReasoningWeb.jsx`'s existing `fire()`/particle-stream mechanism (reversing particle travel direction via a `reverse` flag on the *same* measured SVG path) rather than building a second visual system for inbound/outbound activity — explicitly avoiding "duplicate pathway geometry." Consolidated three previously-duplicated agent data definitions into one `agentRegistry.ts` specifically because the duplication (`ReasoningWeb`'s local `ROSTER`, `ApexWorld`'s local `ROSTER`, `ApexWorld`'s local `INFO`) had already caused real drift risk.
- **Phase 6 — the most consequential structural fix:** discovered during inspection that `ApexHeroOrb` was instantiating its **own, second** `useJarvisController` instance (driving only the 3D core) while `ApexWorld` ran an entirely separate, disconnected 3-value demo tap-cycle (driving the status label, network activity level, and backdrop) — meaning the dashboard had **two different, non-communicating answers** to "what is JARVIS doing." Fixed by moving controller ownership to `ApexWorld` as the single source and retiring the demo cycle completely, including its own duplicated tap-cycle machinery inside `ApexHeroOrb`. Also discovered during Phase 4 (and re-confirmed relevant here) that a `position:fixed` dev panel nested inside a `transform`-bearing ancestor has its stacking context silently trapped by that ancestor (a real CSS gotcha) — fixed by portaling dev panels directly to `document.body`, now the established pattern for any future dev-only overlay.
- **Phase 7:** Chose the browser-native `EventTarget`/`CustomEvent` over any npm event-emitter library specifically to avoid a new runtime dependency for something the platform already provides. Chose to track stale-event timestamps **locally in the bridge's own hook** rather than reading the controller's `since` field, because that field is stamped at *receipt* time (inside the protected, unmodified `useAgentActivityController.ts`), which is a different clock than event *origin* time — comparing incoming timestamps only against other real event timestamps (not against receipt time) keeps the guard meaningful regardless of processing latency.

---

# NEXT ACTION FOR CODEX

Read `KARTERS_DASHBOARD_HANDOFF.md` (this file) completely. Inspect the repository directly — do not trust this document's claims without verifying them against actual source. **Do not modify any code yet.** Perform the Phase 8 pre-implementation inspection described in §14. Compare repository reality against this handoff and report any discrepancies you find. Propose a Phase 8 implementation plan per §15's requirements. **Explicitly preserve and account for the still-unfinished dedicated JARVIS Core visual-refinement requirement (§2, §13)** — do not let Phase 8 quietly become a Core redesign, and do not let Phase 8 be approved without addressing where that Core work fits. Then **stop and wait for the project owner's explicit approval** before writing any implementation code.
