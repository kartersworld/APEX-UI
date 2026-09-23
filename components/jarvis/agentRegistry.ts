/**
 * agentRegistry.ts — Phase 5: the ONE canonical agent/node definition.
 *
 * Before this file, agent data was duplicated across three places:
 *   - ReasoningWeb.jsx's `ROSTER` (positional tuples: network geometry — x/y,
 *     layer, bend, radius, "live" vs. dashed-placeholder)
 *   - ApexWorld.tsx's `ROSTER` ({key,name,color} — backed the accessible
 *     keyboard/screen-reader nav list)
 *   - ApexWorld.tsx's `INFO` (role/capabilities/example-asks/status — backed
 *     the agent overview card)
 * ...manually kept in sync by comment convention ("Mirrors the ROSTER in
 * ReasoningWeb.jsx... keep in sync"). This file replaces all three with one
 * source of truth; ReasoningWeb and ApexWorld now derive from it.
 *
 * IDs are preserved EXACTLY as they existed (chief_of_staff, social_media,
 * etc.) — not renamed for aesthetic consistency, per Phase 5 instructions:
 * changing stable IDs is unnecessary integration risk for zero benefit.
 *
 * Geometry (x/y/bend/r) is copied byte-for-byte from the original
 * ReasoningWeb ROSTER tuples. No node moves as a result of this refactor —
 * this is a data-source change, not a layout change.
 *
 * Pure, framework-agnostic — no React/Three.js/SVG import. Both ReasoningWeb
 * (SVG network) and any future consumer read from here.
 */

export type AgentLayer = "consultant" | "doer" | "tool";
export type AgentStatus = "online" | "standby" | "integration";

export type AgentDefinition = {
  id: AgentId;
  label: string;
  layer: AgentLayer;

  // ── ReasoningWeb network geometry (viewBox units, the 680×480 dark-mode
  // layout) — do not change without visually re-validating the whole graph;
  // these are the current production positions, copied verbatim.
  x: number;
  y: number;
  live: boolean; // true = staffed/real agent; false = dashed "not yet built" placeholder node
  bend: number; // spoke curve control (pathD's bend offset)
  r: number; // node circle radius when live

  // Dark-theme network color, mirroring ReasoningWeb's own `COL[layer]`
  // default. ReasoningWeb still derives its actual rendered color from its
  // own light/dark theme palette (P.col) — this field is for consumers
  // outside that SVG (the accessible nav list, the overview card accent)
  // that need a single agent-level color without importing ReasoningWeb.
  color: string;

  // ── Overview-card metadata (was ApexWorld's INFO) ──────────────────────
  role: string;
  caps: string[];
  asks?: string[];
  status: AgentStatus;
};

export type AgentId =
  | "chief_of_staff"
  | "memory"
  | "strategist"
  | "researcher"
  | "finance"
  | "editor"
  | "sales"
  | "marketing"
  | "ops"
  | "social_media"
  | "engineering"
  | "design"
  | "developer"
  | "analytics"
  | "crm"
  | "calendar"
  | "email"
  | "drive";

const LAYER_COLOR: Record<AgentLayer, string> = {
  consultant: "#00e5ff",
  doer: "#f5a623",
  tool: "#7f9bb3",
};

// Order matters: this is the exact paint/append order ReasoningWeb used to
// build nodesG/spokesG from its own ROSTER array — preserved so z-stacking
// of any overlapping labels/circles is byte-identical to before.
export const AGENT_IDS: AgentId[] = [
  "chief_of_staff",
  "memory",
  "strategist",
  "researcher",
  "finance",
  "editor",
  "sales",
  "marketing",
  "ops",
  "social_media",
  "engineering",
  "design",
  "developer",
  "analytics",
  "crm",
  "calendar",
  "email",
  "drive",
];

export const AGENT_REGISTRY: Record<AgentId, AgentDefinition> = {
  chief_of_staff: {
    id: "chief_of_staff", label: "Chief of staff", layer: "consultant",
    x: 250, y: 212, live: true, bend: 18, r: 9, color: LAYER_COLOR.consultant,
    role: "Right hand - runs the day", status: "online",
    caps: ["Prioritizes the day and keeps loose ends closed", "Routes every request to the right specialist", "Escalates only what truly needs a human"],
    asks: ["What needs attention today?", "Chase the open quotes"],
  },
  memory: {
    id: "memory", label: "Memory", layer: "consultant",
    x: 452, y: 250, live: true, bend: -18, r: 8, color: LAYER_COLOR.consultant,
    role: "Long-term memory", status: "online",
    caps: ["Remembers every client, project and decision", "Feeds context into every task automatically", "Learns preferences over time"],
    asks: ["What did we decide about X?", "History with this client"],
  },
  strategist: {
    id: "strategist", label: "Strategist", layer: "consultant",
    x: 296, y: 118, live: true, bend: -22, r: 6.5, color: LAYER_COLOR.consultant,
    role: "Big-picture thinking", status: "online",
    caps: ["Weekly strategy reviews", "Goal and milestone tracking", "Spots opportunities and risks early"],
    asks: ["Where should we double down?"],
  },
  researcher: {
    id: "researcher", label: "Researcher", layer: "consultant",
    x: 182, y: 150, live: true, bend: 24, r: 6.5, color: LAYER_COLOR.consultant,
    role: "Deep research", status: "online",
    caps: ["Market and competitor research", "Technical deep-dives", "Source-checked summaries"],
    asks: ["Research this market", "Compare these suppliers"],
  },
  finance: {
    id: "finance", label: "Finance", layer: "consultant",
    x: 436, y: 148, live: true, bend: -20, r: 6.5, color: LAYER_COLOR.consultant,
    role: "Money watch", status: "online",
    caps: ["Revenue and pipeline tracking", "Pricing sanity checks", "Monthly performance recaps"],
    asks: ["How was this month?", "Is this quote priced right?"],
  },
  editor: {
    id: "editor", label: "Editor", layer: "consultant",
    x: 584, y: 208, live: true, bend: -26, r: 6.5, color: LAYER_COLOR.consultant,
    role: "Quality gate", status: "online",
    caps: ["Rewrites and tightens every draft", "Keeps the brand voice consistent", "Final pass before anything ships"],
    asks: ["Polish this post", "Tighten this email"],
  },
  sales: {
    id: "sales", label: "Sales", layer: "doer",
    x: 158, y: 266, live: true, bend: 22, r: 6.5, color: LAYER_COLOR.doer,
    role: "Deal closer", status: "online",
    caps: ["Follow-ups for every lead", "Warm-outreach drafts", "Pipeline nudges so nothing goes cold"],
    asks: ["Draft a follow-up", "Who went quiet?"],
  },
  marketing: {
    id: "marketing", label: "Marketing", layer: "doer",
    x: 195, y: 298, live: true, bend: 22, r: 6.5, color: LAYER_COLOR.doer,
    role: "Growth engine", status: "online",
    caps: ["Campaign generation", "Pricing analysis", "Brand positioning and content calendar"],
    asks: ["Generate campaign", "Competitor research"],
  },
  ops: {
    id: "ops", label: "Ops", layer: "doer",
    x: 232, y: 330, live: true, bend: 20, r: 6.5, color: LAYER_COLOR.doer,
    role: "Business operator", status: "online",
    caps: ["Client quotes and proposals", "Project scoping and timelines", "Supplier sourcing"],
    asks: ["Draft client quote", "Build project scope"],
  },
  social_media: {
    id: "social_media", label: "Social", layer: "doer",
    x: 330, y: 374, live: true, bend: -16, r: 6.5, color: LAYER_COLOR.doer,
    role: "Voice of the brand", status: "online",
    caps: ["Writes posts and captions", "Creates reel scripts", "Posts to Instagram, LinkedIn and Facebook"],
    asks: ["Write post caption", "Plan content week"],
  },
  engineering: {
    id: "engineering", label: "Engineering", layer: "doer",
    x: 426, y: 350, live: true, bend: -18, r: 6.5, color: LAYER_COLOR.doer,
    role: "Engineering brain", status: "online",
    caps: ["3D-print settings and materials", "Tolerances and fit", "Laser power and speed guidance"],
    asks: ["Review STL file", "Calculate tolerances"],
  },
  design: {
    id: "design", label: "Design", layer: "doer",
    x: 502, y: 312, live: true, bend: -22, r: 6.5, color: LAYER_COLOR.doer,
    role: "Visual workshop", status: "online",
    caps: ["Background removal and replacement", "Text overlays", "Resize for social media", "Filters and enhancement"],
    asks: ["Remove background", "Resize for IG"],
  },
  developer: {
    id: "developer", label: "Developer", layer: "doer",
    x: 118, y: 356, live: false, bend: 26, r: 6, color: LAYER_COLOR.doer,
    role: "Keeper of the build log", status: "standby",
    caps: ["Keeps Apex's development log", "Recaps what shipped - day / week / month", "Future: builds Apex itself"],
    asks: ["Recap last week"],
  },
  analytics: {
    id: "analytics", label: "Analytics", layer: "tool",
    x: 256, y: 388, live: false, bend: 20, r: 5.5, color: LAYER_COLOR.tool,
    role: "Numbers feed", status: "integration",
    caps: ["Performance metrics across every channel", "Feeds the weekly reviews"],
  },
  crm: {
    id: "crm", label: "CRM", layer: "tool",
    x: 414, y: 392, live: true, bend: -18, r: 5.5, color: LAYER_COLOR.tool,
    role: "Client memory bank", status: "integration",
    caps: ["Every lead and client in one pipeline", "Stage tracking from first contact to paid"],
  },
  calendar: {
    id: "calendar", label: "Calendar", layer: "tool",
    x: 560, y: 356, live: true, bend: -24, r: 5.5, color: LAYER_COLOR.tool,
    role: "Schedule sense", status: "integration",
    caps: ["Knows the calendar", "Reminders and follow-up timing"],
  },
  email: {
    id: "email", label: "Email", layer: "tool",
    x: 608, y: 286, live: false, bend: -26, r: 5.5, color: LAYER_COLOR.tool,
    role: "Inbox hands", status: "integration",
    caps: ["Inbox triage and reply drafts", "Connected and in use"],
  },
  drive: {
    id: "drive", label: "Drive", layer: "tool",
    x: 582, y: 132, live: false, bend: 24, r: 5.5, color: LAYER_COLOR.tool,
    role: "File access", status: "integration",
    caps: ["Reads and files documents", "Connected and in use"],
  },
};
