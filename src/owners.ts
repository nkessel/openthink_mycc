// Projects and events can belong to a coalition or to an organization.
// Coalition-owned items live in coalition.projects/events (optionally with host_org_id);
// org-owned items (no coalition) live in organization.projects/events.
import type { Action, CoalitionEvent, DataFile, GraphNode, Organization, Project } from "./types";
import { initials } from "./util";
import { h } from "./dom";

export interface Owner {
  node: GraphNode;
  name: string;
  abbrev: string;
  color: string;
}

const ORG_COLOR = "#9ca3af";

export function ownerOfCoalition(c: DataFile["coalitions"][number]): Owner {
  return { node: { ...c, kind: "coalition" }, name: c.name, abbrev: c.abbrev || initials(c.name), color: c.color };
}

export function ownerOfOrg(o: Organization): Owner {
  return { node: { ...o, kind: "org" }, name: o.name, abbrev: o.abbrev || initials(o.name), color: ORG_COLOR };
}

export function allProjects(data: DataFile): { project: Project; owner: Owner }[] {
  const rows: { project: Project; owner: Owner }[] = [];
  for (const c of data.coalitions) for (const p of c.projects) rows.push({ project: p, owner: ownerOfCoalition(c) });
  for (const o of data.organizations) for (const p of o.projects || []) rows.push({ project: p, owner: ownerOfOrg(o) });
  return rows;
}

export function allActions(data: DataFile): { action: Action; owner: Owner }[] {
  const rows: { action: Action; owner: Owner }[] = [];
  for (const c of data.coalitions) for (const a of c.actions || []) rows.push({ action: a, owner: ownerOfCoalition(c) });
  for (const o of data.organizations) for (const a of o.actions || []) rows.push({ action: a, owner: ownerOfOrg(o) });
  return rows;
}

/** The owner's logo when it has one, otherwise its colored initials. */
export function ownerBadge(owner: Owner): HTMLElement {
  const logo = (owner.node as { logo?: string }).logo;
  if (logo) return h("div", { class: "coalition-badge logo" }, h("img", { src: logo, alt: "" }));
  return h("div", { class: "coalition-badge", style: `background:${owner.color}` }, owner.abbrev);
}

export function allEvents(data: DataFile): { event: CoalitionEvent; owner: Owner }[] {
  const rows: { event: CoalitionEvent; owner: Owner }[] = [];
  for (const c of data.coalitions) for (const e of c.events) rows.push({ event: e, owner: ownerOfCoalition(c) });
  for (const o of data.organizations) for (const e of o.events || []) rows.push({ event: e, owner: ownerOfOrg(o) });
  return rows;
}

/** An org's own items plus coalition items it hosts. */
export function orgProjects(data: DataFile, org: Organization): Project[] {
  const hosted = data.coalitions.flatMap((c) => c.projects.filter((p) => p.host_org_id === org.id));
  return [...(org.projects || []), ...hosted];
}

export function orgEvents(data: DataFile, org: Organization): CoalitionEvent[] {
  const hosted = data.coalitions.flatMap((c) => c.events.filter((e) => e.host_org_id === org.id));
  return [...(org.events || []), ...hosted];
}

/** Actions and volunteer opportunities: an org's own plus coalition-level ones it hosts. */
export function orgActions(data: DataFile, org: Organization): Action[] {
  const hosted = data.coalitions.flatMap((c) => c.actions.filter((a) => a.host_org_id === org.id));
  return [...(org.actions || []), ...hosted];
}
