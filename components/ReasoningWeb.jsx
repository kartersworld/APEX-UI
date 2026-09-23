"use client";

import { useEffect, useRef } from 'react'
import { AGENT_IDS, AGENT_REGISTRY } from './jarvis/agentRegistry'

// Apex's reasoning web — the lean-orchestrator brain. Two modes:
//   mode="full"  → the whole circuit-brain constellation (front / overview). Orbit rings + PCB
//                  traces + neuron texture + the asymmetric roster, weighted by responsibility
//                  (Chief of staff biggest + closest). On a reasoning turn the consulted nodes
//                  light and cyan particles flow the path.
//   mode="mini"  → chat mode. The core stays calm; only the 1–3 helpers Apex actually consulted
//                  BLOOM out for a beat (pulse + label) then retract. Keeps the corner uncluttered.
// `coreless` hides Apex's own core (used in front mode, layered over the 3D particle orb, so there
// is one bright centre, not two). Driven by the backend `trace` WS event. See APEX_ARCHITECTURE.md.
//
// Aesthetic (ref: navy AI-brain): thin lines, small cyan particles, structured-chaos glow.
// Pure SVG + rAF, built imperatively; decorative (pointer-events none).
//
// Phase 5: node geometry/labels/layer now come from components/jarvis/agentRegistry.ts
// (the canonical registry) instead of a local ROSTER — this file no longer owns agent
// data, only how to render it. Values are unchanged from the original local ROSTER, so
// the rendered layout is byte-identical to before this refactor.

// Site adaptation: `roster`, `anchor` and `viewBox` are optional overrides so a
// caller can re-arrange the constellation (the pitch deck parks Apex to one side
// and needs the roster hanging below the core, not wrapped around it). Omit them
// and this behaves exactly as the app copy does.
const NS = 'http://www.w3.org/2000/svg'
const AX_DEFAULT = 340, AY_DEFAULT = 240   // exact viewBox centre = the orb's world-origin anchor (where the 3D particle
                           // ball is centred), so the spoke hub originates from the particle cluster's centre
                           // — the LOCAL fallback; Phase 5's `anchor` prop, when supplied by ApexWorld's
                           // projected-core-position bridge, supersedes this.
const COL = { consultant: '#00e5ff', doer: '#f5a623', tool: '#7f9bb3' }

// Registry → the same positional-tuple shape this file's rendering logic already
// expects, in the registry's canonical (== original ROSTER) order.
const ROSTER = AGENT_IDS.map((id) => {
  const a = AGENT_REGISTRY[id]
  return [a.id, a.label, a.layer, a.x, a.y, a.live, a.bend, a.r]
})
const META = {}; ROSTER.forEach((r) => { META[r[0]] = { label: r[1], col: COL[r[2]] } })

const LEVEL = { standby: 0.32, listening: 0.6, processing: 0.85, reasoning: 0.95, speaking: 0.78 }

function nodeIdFromHelper(h) {
  const s = String(h || '').replace(/^(ask_|call_|run_|fetch_|get_|delegate_to_|delegate_)/, '')
  return ({ create_visual: 'design', render_visual: 'design', visual: 'design' })[s] || s   // a visual lights Design
}

export default function ReasoningWeb({ state = 'standby', trace = null, mode = 'full', coreless = false, onSelect = null, light = false, roster = null, anchor = null, viewBox = null, traces = true, activity = null }) {
  const svgRef = useRef(null)
  const apiRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect   // click a node → open its cockpit
  // Phase 5: previous `activity` snapshot, diffed below to trigger the right
  // one-shot animation (burst/pulse) exactly once per real transition rather
  // than re-triggering every render.
  const prevActivityRef = useRef(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || apiRef.current) return
    const AX = anchor ? anchor[0] : AX_DEFAULT
    const AY = anchor ? anchor[1] : AY_DEFAULT
    const NODES = roster || ROSTER
    // Day-mode palette (P5) — every structural color routes through P so the web is legible on the
    // light paper bg (labels were white-on-light = invisible). Remounted via key={theme} upstream.
    const P = light ? {
      ring: '#93a9bb', pcb: '#5d7f97', pcbDot: '#0e7490', fieldMesh: '#9db1c0', fieldDot: '#0e7490',
      mesh: '#8ba2b4', spoke: '#46708e', spokeHot: '#0891b2', link: '#0d9488',
      label: '#1f2d3a', labelMinor: '#55677a', labelDorm: '#8a99a8', mote: '#0aa9c8', moteHot: '#067a96',
      col: { consultant: '#067a96', doer: '#b26d05', tool: '#64748b' },
    } : {
      ring: '#1b5f78', pcb: '#1c5f7a', pcbDot: '#37d6ef', fieldMesh: '#143f4f', fieldDot: '#2bd0e6',
      mesh: '#1a5468', spoke: '#22566b', spokeHot: '#33eaff', link: '#5eead4',
      label: '#dfeaf3', labelMinor: '#93a8ba', labelDorm: '#546a7d', mote: '#5fe0f2', moteHot: '#bff6ff',
      col: { consultant: '#00e5ff', doer: '#f5a623', tool: '#7f9bb3' },
    }
    const mk = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e }
    const defs = mk('defs')
    defs.innerHTML = '<filter id="rw-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="rw-soft" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="9"/></filter><filter id="rw-line" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    const ringsG = mk('g'), pcbG = mk('g'), fillG = mk('g'), meshG = mk('g'), spokesG = mk('g'), pulsesG = mk('g'), nodesG = mk('g'), coreG = mk('g')
    svg.append(defs, pcbG, ringsG, fillG, meshG, spokesG, pulsesG, nodesG, coreG)
    // Soft glow on the connective tissue (lines/traces) so the whole web shimmers (ref look). Text
    // labels live in nodesG (unfiltered) so they stay crisp.
    // Dark mode: glow the connective tissue (the shimmer look). Light mode: NO blur — crisp thin
    // lines read as a blueprint on paper; the glow was what made them look foggy gray (Ruben).
    if (!light) [pcbG, meshG, spokesG].forEach((grp) => grp.setAttribute('filter', 'url(#rw-line)'))
    let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    const pathD = (bx, by, bend) => {
      const mx = (AX + bx) / 2, my = (AY + by) / 2, dx = bx - AX, dy = by - AY, l = Math.hypot(dx, dy) || 1
      return `M${AX} ${AY} Q${mx + (-dy / l) * bend} ${my + (dx / l) * bend} ${bx} ${by}`
    }

    // ── shared particle system — small cyan particles flowing a spoke ──
    const live = []
    let allNodes = []           // full-mode roster, for per-node pulsing
    // Phase 5: `reverse` samples the SAME measured path backwards (node→core
    // instead of core→node) — no new geometry, just which end pr=0 starts at.
    const spawn = (spoke, faint, reverse = false) => {
      const el = mk('circle', { r: faint ? 0.9 : 1.4, fill: faint ? P.mote : P.moteHot, filter: 'url(#rw-glow)' })
      pulsesG.append(el); live.push({ el, born: performance.now(), spoke, L: spoke.getTotalLength(), faint, reverse })
    }

    // ── Apex core (unless layered over the 3D orb) ──
    let halo, ring, gold, hot
    if (!coreless) {
      halo = mk('circle', { cx: AX, cy: AY, r: 30, fill: '#0bd0ff', opacity: 0.14, filter: 'url(#rw-soft)' })
      ring = mk('circle', { cx: AX, cy: AY, r: 18, fill: 'none', stroke: '#7df1ff', 'stroke-width': 1.2, opacity: 0.6 })
      gold = mk('circle', { cx: AX, cy: AY, r: 11, fill: '#ffcf6b', filter: 'url(#rw-glow)' })
      hot = mk('circle', { cx: AX, cy: AY, r: 4, fill: '#ffffff', filter: 'url(#rw-glow)' })
      const lab = mk('text', { x: AX, y: AY + 34, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'inherit', fill: '#ffcf6b' })
      lab.textContent = 'Apex'
      coreG.append(halo, ring, gold, hot, lab)
    }

    let fire
    if (mode === 'full') {
      // Concentric orbit rings + PCB circuit traces — thin, faint, "structured chaos".
      ;[72, 128, 186].forEach((r) => ringsG.append(mk('circle', { cx: AX, cy: AY, r, fill: 'none', stroke: P.ring, opacity: 0.32, 'stroke-width': 1, 'stroke-dasharray': '1 7' })))
      // Long PCB traces fanning right out to the edges (start just outside the orb ring), each ending
      // in a glowing terminal circle. Mid-band vertically.
      // Site adaptation: `traces={false}` drops them - beside a slide they read as
      // stray rules across the text rather than as circuitry.
      ;[-1, 1].forEach((side) => { if (!traces) return; for (let i = 0; i < 6; i++) {
        const y = AY + (i - 2.5) * 52 + (rnd() * 16 - 8)
        const startX = AX + side * (126 + rnd() * 34)
        const midX = side < 0 ? (40 + rnd() * 56) : (584 + rnd() * 56)
        const y2 = y + (rnd() * 30 - 15)
        const jogX = side < 0 ? (10 + rnd() * 18) : (652 + rnd() * 18)
        pcbG.append(mk('path', { d: `M${startX} ${y} H${midX} V${y2} H${jogX}`, fill: 'none', stroke: P.pcb, opacity: 0.5, 'stroke-width': 1 }))
        pcbG.append(mk('circle', { cx: jogX, cy: y2, r: 2.4, fill: P.pcbDot, opacity: 0.85 }))   // glowing end (via group glow)
        pcbG.append(mk('circle', { cx: startX, cy: y, r: 1.3, fill: P.fieldDot, opacity: 0.45 }))
      } })
      // Ordered chaos: keep the neuron texture sparse + LOCAL so it never tangles into the spokes.
      const fill = []; for (let i = 0; i < 15; i++) { const x = 36 + rnd() * 608, y = 34 + rnd() * 412; if (Math.hypot(x - AX, y - AY) > 175) fill.push({ x, y }) }
      fill.forEach((f) => {
        let near = null, nd = 1e9
        fill.forEach((g) => { if (g !== f) { const d = Math.hypot(g.x - f.x, g.y - f.y); if (d < nd) { nd = d; near = g } } })
        if (near && nd < 110) meshG.append(mk('line', { x1: f.x, y1: f.y, x2: near.x, y2: near.y, stroke: P.fieldMesh, 'stroke-width': 1, opacity: 0.45 }))
        const c = mk('circle', { cx: f.x, cy: f.y, r: 1.1, fill: P.fieldDot })
        c.style.animation = `rwTwinkle 4s ease-in-out ${(rnd() * 4).toFixed(2)}s infinite`
        fillG.append(c)
      })
      const map = {}, pts = []
      NODES.forEach((r) => { const n = { id: r[0], label: r[1], layer: r[2], x: r[3], y: r[4], live: r[5], bend: r[6], r: r[7], col: P.col[r[2]] || COL[r[2]] }; map[r[0]] = n; pts.push(n) })
      // Keep a clear moat around the centre so no node sits ON the orb — push the inner ring out.
      const MINR = 128
      pts.forEach((n) => { const dx = n.x - AX, dy = n.y - AY, d = Math.hypot(dx, dy) || 1; if (d < MINR) { n.x = AX + dx / d * MINR; n.y = AY + dy / d * MINR } })
      // Only the SINGLE nearest neighbour per node — enough to feel networked without a tangle.
      pts.forEach((n) => {
        const o = pts.filter((m) => m !== n).map((m) => ({ m, d: Math.hypot(m.x - n.x, m.y - n.y) })).sort((a, b) => a.d - b.d)[0]
        if (o && n.id < o.m.id && o.d < 150) meshG.append(mk('line', { x1: n.x, y1: n.y, x2: o.m.x, y2: o.m.y, stroke: P.mesh, 'stroke-width': 1, opacity: 0.5 }))
      })
      pts.forEach((n) => {
        n.spoke = mk('path', { d: pathD(n.x, n.y, n.bend), fill: 'none', stroke: P.spoke, 'stroke-width': 1, opacity: n.live ? 0.78 : 0.4 })
        spokesG.append(n.spoke)
        // Glowing ring (circumference only) — soft halo behind (pulses on its own phase), hollow ring on top.
        const rr = n.live ? n.r : 5.5
        n.haloR = rr + 1.5; n.phase = rnd() * 6.283
        n.halo = mk('circle', { cx: n.x, cy: n.y, r: n.haloR, fill: n.col, filter: 'url(#rw-glow)', opacity: n.live ? 0.34 : 0.2 })
        nodesG.append(n.halo)
        n.circ = mk('circle', { cx: n.x, cy: n.y, r: rr, fill: 'none', stroke: n.col, 'stroke-width': n.live ? 2 : 1.3, opacity: n.live ? 1 : 0.6 })
        if (!n.live) n.circ.setAttribute('stroke-dasharray', '2 2')
        nodesG.append(n.circ)
        const dx = n.x - AX, dy = n.y - AY, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, off = rr + 11
        // Bottom-most nodes: label ABOVE the node so it doesn't drop into the STANDBY bar below.
        const above = uy > 0.82
        // Visual hierarchy (UI sweep): tool dorms + unbuilt nodes must not carry the same label weight
        // as live AGENTS — a dashed "Drive" reading as big as "Design" was misleading the map.
        const minor = !n.live || n.layer === 'tool'
        const t = mk('text', {
          x: above ? n.x : n.x + ux * off,
          y: above ? n.y - (rr + 9) : n.y + uy * off + (Math.abs(uy) < 0.3 ? 4 : 0),
          'text-anchor': above ? 'middle' : (ux > 0.3 ? 'start' : (ux < -0.3 ? 'end' : 'middle')),
          'font-size': minor ? 9.5 : 12, 'font-family': 'inherit',
          fill: !n.live ? P.labelDorm : (minor ? P.labelMinor : P.label),
          opacity: !n.live ? 0.75 : 1 })
        t.textContent = n.label
        nodesG.append(t)
        // Clickable: a generous transparent hit target over the node opens its cockpit. The SVG is
        // pointer-events:none (decorative), but this child re-enables events for itself only.
        const hit = mk('circle', { cx: n.x, cy: n.y, r: Math.max(rr + 13, 17), fill: 'transparent' })
        hit.style.pointerEvents = 'all'; hit.style.cursor = 'pointer'   // 'all' captures over a transparent fill ('auto' needs visible paint)
        hit.addEventListener('click', () => onSelectRef.current && onSelectRef.current({ name: n.label, key: n.id, color: n.col }))
        nodesG.append(hit)
      })
      // Phase 5: the single-node burst extracted from `fire`'s per-id body,
      // unchanged in timing/behavior, now parameterized by direction so it
      // can serve both the original outbound-only `fire(ids)` and the new
      // activateAgent/returnAgent API. `reverse` only changes which end of
      // the SAME measured path (n.spoke) particles start from — see spawn().
      const burstOne = (n, { reverse = false } = {}) => {
        if (!n) return
        n._bursting = true // pauses the per-frame loop's working/error stroke-width writes until this settles
        n.spoke.setAttribute('stroke', P.spokeHot); n.spoke.setAttribute('stroke-width', 1.6)
        n.spoke.setAttribute('opacity', 0.7)
        n._until = performance.now() + 1150
        const stream = () => { if (performance.now() < n._until) { spawn(n.spoke, false, reverse); setTimeout(stream, 105) } }
        stream()
        setTimeout(() => { n.circ.setAttribute('filter', 'url(#rw-glow)'); n.circ.setAttribute('r', (n.live ? n.r : 5.5) + 3); n.circ.setAttribute('stroke-width', n.live ? 3 : 2); n.circ.setAttribute('opacity', 1) }, 560)
        setTimeout(() => {
          n._bursting = false
          n.spoke.setAttribute('stroke', P.spoke); n.spoke.setAttribute('stroke-width', 1)
          n.spoke.setAttribute('opacity', n.live ? 0.78 : 0.4)
          n.circ.removeAttribute('filter')
          // Phase 5: land back on the WORKING look if the agent is still
          // marked working (persistent state), not necessarily the resting
          // look — otherwise a burst mid-work would visibly "reset" the node.
          const restR = n.working ? (n.live ? n.r : 5.5) + 1.5 : (n.live ? n.r : 5.5)
          const restSW = n.working ? (n.live ? 2.6 : 1.8) : (n.live ? 2 : 1.3)
          n.circ.setAttribute('r', restR); n.circ.setAttribute('stroke-width', restSW); n.circ.setAttribute('opacity', n.live ? 1 : 0.6)
        }, 2050)
      }

      // Phase 5: brief, restrained completion acknowledgement — one ring
      // pulse (reusing the SAME glow step as burstOne, no new visual
      // vocabulary), then flags clear so the per-frame loop below settles
      // the node back toward its plain idle breathing.
      const pulseComplete = (n) => {
        if (!n) return
        n.circ.setAttribute('filter', 'url(#rw-glow)')
        n.circ.setAttribute('r', (n.live ? n.r : 5.5) + 2.5)
        n.circ.setAttribute('stroke-width', n.live ? 2.6 : 1.8)
        setTimeout(() => {
          n.working = false; n.errorFlag = false
          n.circ.removeAttribute('filter')
          n.circ.setAttribute('r', n.live ? n.r : 5.5)
          n.circ.setAttribute('stroke-width', n.live ? 2 : 1.3)
        }, 900)
      }

      fire = (ids) => {
        ids.forEach((id, k) => { setTimeout(() => burstOne(map[id]), k * 210) })
        // connections between co-active agents — a transient link so multiple agents working the same turn
        // READ as collaborating (not just Apex→each). Auto-removed after ~2.4s.
        const co = ids.map((id) => map[id]).filter(Boolean)
        for (let i = 0; i < co.length - 1; i++) {
          const a = co[i], b = co[i + 1]
          const ln = mk('line', {
            x1: +a.circ.getAttribute('cx'), y1: +a.circ.getAttribute('cy'),
            x2: +b.circ.getAttribute('cx'), y2: +b.circ.getAttribute('cy'),
            stroke: P.link, 'stroke-width': 1.3, opacity: 0,   // solid agent↔agent link (no dashes)
          })
          pulsesG.append(ln)
          setTimeout(() => ln.setAttribute('opacity', 0.6), 560)
          setTimeout(() => ln.remove(), 2400)
        }
      }
      allNodes = pts
      apiRef.current = {
        fire, // unchanged — existing callers (the `trace` prop path) keep working exactly as before
        // Phase 5 additions — the new activity-driven API:
        activateAgent: (id) => burstOne(map[id], { reverse: false }),  // outbound JARVIS → Agent
        returnAgent: (id) => burstOne(map[id], { reverse: true }),     // inbound Agent → JARVIS
        setWorking: (id, on) => { const n = map[id]; if (n) n.working = !!on },
        setErrorFlag: (id, on) => { const n = map[id]; if (n) n.errorFlag = !!on },
        completeAgent: (id) => pulseComplete(map[id]),
        resetAgent: (id) => { const n = map[id]; if (n) { n.working = false; n.errorFlag = false } },
        liveNodes: pts.filter((p) => p.live), allSpokes: pts.map((p) => p.spoke),
      }
    } else {
      // mini — calm core, on-demand bloom.
      ;[34, 64].forEach((r) => ringsG.append(mk('circle', { cx: AX, cy: AY, r, fill: 'none', stroke: P.ring, opacity: 0.3, 'stroke-width': 1, 'stroke-dasharray': '1 7' })))
      const bloomEls = []; let fadeT = null
      const bloomOne = (id, angDeg, store) => {
        const info = META[id]; if (!info) return
        const a = angDeg * Math.PI / 180, R = 98
        const nx = AX + R * Math.cos(a), ny = AY + R * Math.sin(a)
        const cpx = AX + (nx - AX) * 0.5 - (ny - AY) * 0.18, cpy = AY + (ny - AY) * 0.5 + (nx - AX) * 0.18
        const sp = mk('path', { d: `M${AX} ${AY} Q${cpx} ${cpy} ${nx} ${ny}`, fill: 'none', stroke: info.col, 'stroke-width': 1.6, opacity: 0 })
        spokesG.append(sp); store.push(sp); sp.style.transition = 'opacity .3s'; requestAnimationFrame(() => sp.setAttribute('opacity', 0.5))
        const until = performance.now() + 1100
        const stream = () => { if (performance.now() < until) { spawn(sp, false); setTimeout(stream, 105) } }
        stream()
        setTimeout(() => {
          const g = mk('circle', { cx: nx, cy: ny, r: 0, fill: info.col, filter: 'url(#rw-glow)' }); nodesG.append(g); store.push(g)
          g.style.transition = 'r .3s'; requestAnimationFrame(() => g.setAttribute('r', 6.5))
          const ux = (nx - AX) / R, uy = (ny - AY) / R
          const t = mk('text', { x: nx + ux * 13, y: ny + uy * 13 + (Math.abs(uy) < 0.3 ? 4 : 0), 'text-anchor': ux > 0.3 ? 'start' : (ux < -0.3 ? 'end' : 'middle'), 'font-size': 12, 'font-family': 'inherit', fill: P.label, opacity: 0 })
          t.textContent = info.label; nodesG.append(t); store.push(t); t.style.transition = 'opacity .35s'; requestAnimationFrame(() => t.setAttribute('opacity', 1))
        }, 520)
      }
      fire = (ids) => {
        if (fadeT) clearTimeout(fadeT)
        bloomEls.forEach((e) => e.remove()); bloomEls.length = 0
        const c = ids.length, layouts = { 1: [-48], 2: [-74, -20], 3: [-118, -62, -8] }
        const angs = layouts[c] || ids.map((_, j) => -90 + (j - (c - 1) / 2) * 46)
        ids.forEach((id, k) => setTimeout(() => bloomOne(id, angs[k], bloomEls), k * 200))
        fadeT = setTimeout(() => {
          bloomEls.forEach((e) => { e.style.transition = 'opacity .6s'; e.setAttribute('opacity', 0) })
          setTimeout(() => { bloomEls.forEach((e) => e.remove()); bloomEls.length = 0 }, 650)
        }, c * 200 + 2600)
      }
      apiRef.current = { fire, liveNodes: [] }
    }

    let raf = 0, last = performance.now(), phase = 0, nextAmbient = last + 1200
    const loop = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t
      const lvl = LEVEL[stateRef.current] ?? 0.4
      const awake = stateRef.current !== 'standby'
      // One phase clock that runs FASTER when Apex is awake — drives all the glow/pulsing, so the
      // whole web visibly quickens the moment Apex wakes (no period jump: we accumulate phase).
      phase += dt * (0.85 + 1.9 * lvl)
      const k = (Math.sin(phase) + 1) / 2
      if (!coreless) {
        gold.setAttribute('r', (9 + 4 * lvl) + (1.4 + 1.8 * lvl) * k)
        hot.setAttribute('r', 3.4 + 1.2 * lvl + 1 * k)
        halo.setAttribute('r', 26 + 8 * lvl + 5 * k); halo.setAttribute('opacity', (0.08 + 0.1 * lvl) + 0.06 * k)
        ring.setAttribute('r', 18 + 2.4 * k); ring.setAttribute('opacity', (0.4 + 0.25 * lvl) + 0.18 * k)
      }
      // Every node breathes on its OWN phase (ordered chaos — never all at once).
      // Phase 5: `n.working`/`n.errorFlag` are plain flags toggled by the new
      // activity API (setWorking/setErrorFlag) — read here, in the SAME
      // existing per-frame loop, so a persistent "working" or "error" look
      // costs nothing beyond what was already running (no new rAF loop, no
      // continuous particle stream for a resting working agent).
      for (let i = 0; i < allNodes.length; i++) {
        const n = allNodes[i]; if (!n.halo) continue
        // Error nodes get a slightly irregular phase (a second, faster,
        // differently-seeded wave folded in) instead of a color change —
        // "disturbed" reads through irregularity, staying inside the
        // existing palette rather than introducing an alarm color.
        const errJitter = n.errorFlag ? Math.sin(phase * 2.3 + n.phase * 1.7) * 0.5 : 0
        const kk = (Math.sin(phase * 0.85 + n.phase) + 1) / 2 + errJitter * 0.18
        const workBoost = n.working ? 1 : 0
        n.halo.setAttribute('opacity', (n.live ? 0.16 : 0.09) + (n.live ? 0.30 : 0.18) * kk + workBoost * 0.2)
        n.halo.setAttribute('r', n.haloR + 2 * kk + workBoost * 1.4)
        if (n.circ && (n.working || n.errorFlag) && !n._bursting) {
          // Only touch stroke-width here when NOT mid-burst (burstOne owns
          // it during a burst and restores the working-aware rest value
          // itself) — avoids two writers fighting the same attribute.
          n.circ.setAttribute('stroke-width', n.live ? 2.6 : 1.8)
        }
      }
      // Ambient "thinking" — a constant gentle drift of faint motes from the core out to ALL parts.
      // Denser + faster when Apex is awake (two at a time), so the whole web feels alive.
      if (mode === 'full' && t > nextAmbient && live.length < (awake ? 18 : 8)) {
        const sp = apiRef.current.allSpokes
        if (sp.length) { spawn(sp[(Math.random() * sp.length) | 0], true); if (awake && Math.random() < 0.6) spawn(sp[(Math.random() * sp.length) | 0], true) }
        const base = 470 - 330 * lvl
        nextAmbient = t + base * (0.5 + Math.random() * 0.7)
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i], pr = (t - p.born) / 620
        if (pr >= 1) { p.el.remove(); live.splice(i, 1); continue }
        const q = p.spoke.getPointAtLength((p.reverse ? (1 - pr) : pr) * p.L)
        p.el.setAttribute('cx', q.x); p.el.setAttribute('cy', q.y)
        p.el.setAttribute('opacity', (p.faint ? 0.4 : 0.9) * Math.sin(pr * Math.PI))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); apiRef.current = null; svg.replaceChildren() }
  }, [mode, coreless, roster, anchor, viewBox, traces])

  useEffect(() => {
    if (!trace || !apiRef.current) return
    const ids = (trace.trace || []).map((h) => nodeIdFromHelper(h.helper)).filter((id) => META[id])
    if (ids.length) apiRef.current.fire(ids)
  }, [trace?.n])

  // Phase 5: the new activity-driven path. `activity` is a plain
  // Record<AgentId, {status, since}> (see useAgentActivityController) —
  // this diffs it against the previous snapshot and triggers exactly one
  // imperative call per REAL transition, so re-renders that don't change
  // any status are no-ops. This is the only place that translates activity
  // STATE into ReasoningWeb visuals — callers (manual clicks, future
  // backend events) only ever change the data, never call these methods
  // directly.
  useEffect(() => {
    if (!activity || !apiRef.current) return
    const api = apiRef.current
    const prev = prevActivityRef.current || {}
    for (const id in activity) {
      const status = activity[id]?.status
      const prevStatus = prev[id]?.status
      if (status === prevStatus) continue
      switch (status) {
        case 'activating':
          api.activateAgent(id)
          break
        case 'working':
          // Only burst on ENTRY to working from a non-active state — if we
          // just came from 'activating' the outbound burst already played,
          // so this would otherwise double-fire.
          if (prevStatus !== 'activating') api.activateAgent(id)
          api.setWorking(id, true)
          break
        case 'returning':
          api.setWorking(id, false)
          api.returnAgent(id)
          break
        case 'complete':
          api.completeAgent(id)
          break
        case 'error':
          api.setWorking(id, false)
          api.setErrorFlag(id, true)
          break
        case 'idle':
        default:
          api.resetAgent(id)
          break
      }
    }
    prevActivityRef.current = activity
  }, [activity])

  return (
    <>
      <style>{`@keyframes rwTwinkle{0%,100%{opacity:.14}50%{opacity:.42}}@keyframes rwFlow{to{stroke-dashoffset:-14}}`}</style>
      <svg ref={svgRef} width="100%" height="100%" viewBox={viewBox || "0 0 680 480"}
           preserveAspectRatio="xMidYMid meet"
           style={{ fontFamily: 'inherit', pointerEvents: 'none', overflow: 'visible' }}
           role="img" aria-label="Apex reasoning web" />
    </>
  )
}
