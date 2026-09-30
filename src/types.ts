export type ProjectStatus = "active" | "planning" | "completed";
export type Urgency = "low" | "medium" | "high";
export type ActionKind = "task" | "role";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  skills_needed: string[];
  // Optional fields filled in through the MA Climate Coalition Map forms
  /** We could not confirm this is current; shown with a "needs more information" notice until a point person updates it. */
  needs_info?: boolean;
  host_org_id?: string;
  topic_tags?: string[];
  link?: string;
  public_contact?: string;
  location?: string;
  online?: boolean;
  lat?: number;
  lng?: number;
}

export interface CoalitionEvent {
  id: string;
  name: string;
  date: string;
  location: string;
  // Optional fields filled in through the MA Climate Coalition Map forms
  /** A date with no time part ("2026-10-12") means the source did not post a time. */
  /** Repeats on a schedule, e.g. "Every Saturday, 12-1 PM". `date` is then the next occurrence. */
  recurrence?: string;
  /** End date-time (same day as `date`), if given. */
  end?: string;
  description?: string;
  needs_info?: boolean;
  host_org_id?: string;
  topic_tags?: string[];
  link?: string;
  public_contact?: string;
  online?: boolean;
  lat?: number;
  lng?: number;
}

/**
 * A piece of an org's or coalition's public thinking: a topic it is working through, a decision it made,
 * or an open question. Shown as a "thinking" bubble when you zoom into the org. Everything in
 * public/thoughts.json has been approved by the org for public display.
 */
export type ThoughtKind = "topic" | "decision" | "question" | "update";
export interface Thought {
  id: string;
  kind: ThoughtKind;
  text: string;
  /** When it was discussed (ISO date). */
  date?: string;
  /** Where it came from, e.g. "MYCC full-coalition call, Sept 6". Shown so readers can trace it. */
  source: string;
  link?: string;
}

export interface Action {
  id: string;
  kind: ActionKind;
  name: string;
  /** Optional: only shown when the source says how urgent it is. */
  urgency?: Urgency;
  skills_needed: string[];
  deadline: string | null;
  // Optional: actions can belong to an org as well as a coalition, and should link to where to act.
  description?: string;
  link?: string;
  needs_info?: boolean;
  host_org_id?: string;
}

export interface Coalition {
  id: string;
  name: string;
  abbrev: string;
  description: string;
  focus_tags: string[];
  geographic_scope: string;
  color: string;
  lat: number;
  lng: number;
  member_ids: string[];
  member_count: number;
  projects: Project[];
  events: CoalitionEvent[];
  actions: Action[];
  last_activity: string;
  /** Relative path (logos/coalition_<id>.png) or an absolute image URL. */
  logo?: string;
  website?: string;
  /** Public thinking (merged in from public/thoughts.json). */
  thoughts?: Thought[];
}

export interface Organization {
  id: string;
  name: string;
  type: string;
  geographic_focus: string;
  description: string;
  coalition_ids: string[];
  lat: number;
  lng: number;
  last_activity: string;
  // From the MA Climate Coalition Map import and/or the map forms
  abbrev?: string;
  website?: string;
  /** Relative path (logos/<id>.png) or an absolute image URL. */
  logo?: string;
  /** No public location: listed, but no pin on the geographic map. */
  remote?: boolean;
  public_contact?: string;
  topic_tags?: string[];
  profile?: OrgProfile;
  /** Strength of each coalition tie (1–4), keyed by coalition id. */
  coalition_weights?: Record<string, number>;
  /** Projects/events that belong to this org rather than a coalition. */
  projects?: Project[];
  events?: CoalitionEvent[];
  actions?: Action[];
  /** Public thinking (merged in from public/thoughts.json). */
  thoughts?: Thought[];
}

/** Org attributes from the MA Climate Coalition Map. Scores are 1–4. */
export interface OrgProfile {
  youth_serving?: boolean;
  school_club?: boolean;
  hub?: boolean;
  inactive?: boolean;
  paid_staff?: boolean;
  ej_focus?: number;
  grassroots?: number;
  policy_expertise?: number;
  in_building?: number;
  membership_size?: string;
  c3_tier?: string;
  c4_tier?: string;
  geo_precision?: "exact" | "approx" | string;
}

export interface Edge {
  source: string;
  target: string;
}

export interface DataFile {
  generated_at: string;
  /** Org-to-org connections; optional for older data files. */
  org_links?: OrgLink[];
  coalitions: Coalition[];
  organizations: Organization[];
  edges: Edge[];
}

// Graph node + link types for D3 force layout.
export interface CoalitionNode extends Coalition {
  kind: "coalition";
  // D3-managed fields after simulation runs:
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

export interface OrgNode extends Organization {
  kind: "org";
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

export type GraphNode = CoalitionNode | OrgNode;

export interface GraphLink {
  source: GraphNode | string;
  target: GraphNode | string;
  /** Coalition id for membership links; "" for org-to-org links. */
  coalitionId: string;
  kind?: "membership" | "org";
  /** Org-to-org strength, 1 (yearly or less) … 4 (weekly). */
  weight?: number;
}

/** How often two orgs work together (from the organization form). */
export type LinkFrequency = "weekly" | "monthly" | "few_per_year" | "yearly";

export interface OrgLink {
  source: string;
  target: string;
  frequency: LinkFrequency | string;
  weight: number;
  /** Org ids that reported this connection. */
  reported_by: string[];
}
