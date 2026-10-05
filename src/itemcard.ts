// The detail card for one event, project or action, shown over a page (Events, Topics…) without leaving it.
import type { Action, CoalitionEvent, DataFile, Project } from "./types";
import { allActions, allEvents, allProjects, ownerBadge, sectorAttrs, sectorPill, type Owner } from "./owners";
import { itemButtons } from "./links";
import { h } from "./dom";
import { staleNotice } from "./notice";
import { fmtEventTime, hasTime, parseEventDate } from "./util";

export type CardKind = "event" | "project" | "action";
export type CardItem = CoalitionEvent | Project | Action;

/** Find an item by id in the map data, with its owner. */
export function findItem(data: DataFile, id: string): { kind: CardKind; item: CardItem; owner: Owner } | null {
  for (const r of allEvents(data)) if (r.event.id === id) return { kind: "event", item: r.event, owner: r.owner };
  for (const r of allProjects(data)) if (r.project.id === id) return { kind: "project", item: r.project, owner: r.owner };
  for (const r of allActions(data)) if (r.action.id === id) return { kind: "action", item: r.action, owner: r.owner };
  return null;
}

/** What the card's buttons do (set once by main.ts): open the full details pane, or find the item on a map. */
export interface CardActions {
  details(kind: CardKind, item: CardItem, owner: Owner): void;
  locateMap(kind: CardKind, item: CardItem, owner: Owner): void;
  locateGeo?(kind: CardKind, item: CardItem, owner: Owner): void;
  /** Whether the item (or its group) has a place on the geographic map. */
  hasGeo?(kind: CardKind, item: CardItem, owner: Owner): boolean;
}
let actions: CardActions | null = null;
export function setCardActions(a: CardActions): void {
  actions = a;
}

/** Show the card over `host`; "See … on the map" calls onMap. With `at` (a point on screen) it pops up beside
 *  that point instead, without covering the rest of the page, so the page's own details stay in view. */
export function showItemCard(host: HTMLElement, kind: CardKind, item: CardItem, owner: Owner, onMap: () => void, at?: { x: number; y: number }): void {
  host.querySelectorAll(".detail-overlay, .item-pop").forEach((n) => n.remove());
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onOutside, true);
  };
  const onOutside = (ev: PointerEvent) => {
    if (!card.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  };
  const x = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
  x.addEventListener("click", close);
  // A quick look first; "More details" opens the full pane, the "Locate" buttons go to the item on a map.
  const btn = (label: string, cls: string, go: () => void) => {
    const b = h("button", { class: cls, type: "button" }, label);
    b.addEventListener("click", () => {
      close();
      go();
    });
    return b;
  };
  const toMap = actions
    ? h("div", { class: "card-actions" },
        btn("More details →", "detail-map-btn primary", () => actions!.details(kind, item, owner)),
        btn("Locate on strategy map", "detail-map-btn", () => actions!.locateMap(kind, item, owner)),
        actions.locateGeo && (actions.hasGeo?.(kind, item, owner) ?? true) ? btn("Locate on geographic map", "detail-map-btn", () => actions!.locateGeo!(kind, item, owner)) : null)
    : btn(`See ${owner.name} on the map`, "detail-map-btn", onMap);
  const e = item as CoalitionEvent, p = item as Project, a = item as Action;
  const pills: (HTMLElement | null)[] = [];
  if (kind === "event") {
    const upcoming = !!e.recurrence || parseEventDate(e.date).getTime() + (hasTime(e.date) ? 0 : 86400000) >= Date.now();
    pills.push(
      h("span", { class: "pill deadline" }, fmtEventTime(e.date, e.end, e.recurrence)),
      e.location ? h("span", { class: "pill kind" }, e.location) : null,
      e.online ? h("span", { class: "pill" }, "online") : null,
      !upcoming ? h("span", { class: "pill" }, "past") : null,
    );
  } else if (kind === "project") {
    pills.push(h("span", { class: "pill kind" }, `Project · ${p.status || "active"}`), p.location ? h("span", { class: "pill" }, p.location) : null);
  } else {
    pills.push(
      h("span", { class: "pill kind" }, a.kind === "role" ? "Volunteer role" : "Action"),
      a.deadline ? h("span", { class: "pill deadline" }, `Deadline ${a.deadline}`) : null,
      a.urgency ? h("span", { class: "pill" }, a.urgency) : null,
    );
  }
  const tags = (item as { topic_tags?: string[] }).topic_tags;
  const skills = (item as { skills_needed?: string[] }).skills_needed;
  const contact = (item as { public_contact?: string }).public_contact;
  const sa = sectorAttrs(owner);
  const card = h("div", { class: `detail-card${sa.cls}`, style: sa.style, role: "dialog", "aria-label": item.name },
    x,
    h("div", { class: "head" }, ownerBadge(owner), h("div", { class: "coalition-name" }, owner.name), sectorPill(owner)),
    h("h3", {}, item.name),
    h("div", { class: "meta-row" }, ...pills),
    item.description ? h("p", { class: "detail-desc" }, item.description) : null,
    tags && tags.length ? h("div", { class: "detail-tags" }, tags.map((t) => t.replace(/_/g, " ")).join(" · ")) : null,
    skills && skills.length ? h("div", { class: "detail-tags" }, `Skills that help: ${skills.join(", ")}`) : null,
    contact ? h("div", { class: "detail-contact" }, `Contact: ${contact}`) : null,
    itemButtons(kind, item as { rsvp_link?: string; link?: string }),
    staleNotice(kind, owner.node, (item as { needs_info?: boolean }).needs_info, (item as { verified?: boolean }).verified, item as never),
    toMap);
  const overlay = at ? h("div", { class: "item-pop" }, card) : h("div", { class: "detail-overlay" }, card);
  if (!at) {
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });
  }
  document.addEventListener("keydown", onKey, true);
  host.appendChild(overlay);
  if (at) {
    // beside the point: to its right when there's room, else to its left; kept on screen
    const r = card.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14;
    let left = at.x + gap;
    if (left + r.width > vw - 8) left = at.x - gap - r.width;
    left = Math.max(8, Math.min(vw - r.width - 8, left));
    const top = Math.max(8, Math.min(vh - r.height - 8, at.y - 40));
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  }
  x.focus({ preventScroll: true });
}
