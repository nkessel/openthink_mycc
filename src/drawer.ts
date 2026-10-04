import type {
  Coalition,
  Organization,
  Action,
  CoalitionEvent,
  Project,
  GraphNode,
  DataFile,
} from "./types";
import { initials, relTime, fmtEventTime, typeLabel } from "./util";
import { itemButtons } from "./links";
import { h, clear } from "./dom";
import { staleNotice } from "./notice";
import { formUrl } from "./fab";
import { sectorById } from "./sectors";
import { orgProjects, orgEvents, orgActions } from "./owners";
import { suggestionsFor } from "./suggestions";

type DrawerTab = "projects" | "events" | "actions" | "coalitions" | "suggested" | "about";

export interface Drawer {
  open(node: GraphNode): void;
  close(): void;
  isOpen(): boolean;
  current(): GraphNode | null;
  setActiveTab(tab: DrawerTab): void;
  /** Show one event / project / action in full, with a way back to its group. */
  openItem(kind: ItemKind, item: CoalitionEvent | Project | Action, owner: GraphNode): void;
}

export type ItemKind = "event" | "project" | "action";

export interface DrawerCallbacks {
  onCoalitionClick?(coalitionId: string): void;
  onOrgClick?(orgId: string): void;
}

export function createDrawer(
  parent: HTMLElement,
  data: DataFile,
  cb: DrawerCallbacks = {},
): Drawer {
  const el = h("aside", { class: "drawer" });
  parent.appendChild(el);

  let currentNode: GraphNode | null = null;
  let activeTab: DrawerTab = "about";
  let currentItem: { kind: ItemKind; item: CoalitionEvent | Project | Action } | null = null;
  const orgsById = new Map(data.organizations.map((o) => [o.id, o]));
  const coalitionsById = new Map(data.coalitions.map((c) => [c.id, c]));

  function renderHead(node: GraphNode): HTMLElement {
    const head = h("div", { class: "head" });
    const closeBtn = h("button", { class: "close", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", () => api.close());
    head.appendChild(closeBtn);

    if (node.kind === "coalition") {
      const c = node as Coalition;
      head.appendChild(
        h(
          "div",
          { class: "title-row" },
          c.logo
            ? h("div", { class: "badge logo", style: `border:2px solid ${c.color}` }, h("img", { src: c.logo, alt: "" }))
            : h(
                "div",
                { class: "badge", style: `background:${c.color}` },
                c.abbrev || initials(c.name),
              ),
          h(
            "div",
            {},
            h("h2", {}, c.name),
            h("div", { class: "sub" }, `${c.geographic_scope} coalition`),
          ),
        ),
      );
      head.appendChild(h("div", { class: "desc" }, c.description));
      if (c.focus_tags.length) {
        const tags = h("div", { class: "tags" });
        for (const t of c.focus_tags) {
          tags.appendChild(h("span", { class: "tag" }, prettifyTag(t)));
        }
        head.appendChild(tags);
      }
      head.appendChild(
        h(
          "div",
          { class: "meta" },
          metaCell(c.member_count, "Member groups"),
          metaCell(c.projects.length, "Projects"),
          metaCell(c.events.length, "Events"),
        ),
      );
    } else {
      const o = node as Organization;
      const badge = o.logo
        ? h("div", { class: "badge logo" }, h("img", { src: o.logo, alt: "" }))
        : h("div", { class: "badge", style: "background:#3a3a4a;color:#e5e7eb" }, initials(o.name));
      const sub = [o.abbrev, typeLabel(o.type), o.geographic_focus].filter(Boolean).join(" · ");
      head.appendChild(
        h("div", { class: "title-row" }, badge, h("div", {}, h("h2", {}, o.name), h("div", { class: "sub" }, sub))),
      );
      head.appendChild(
        o.description
          ? h("div", { class: "desc" }, o.description)
          : h("div", { class: "desc faint" }, "No description yet."),
      );
      const tags = h("div", { class: "tags" });
      if (o.profile?.youth_serving) tags.appendChild(h("span", { class: "tag" }, "Youth-serving"));
      if (o.profile?.school_club) tags.appendChild(h("span", { class: "tag" }, "School club"));
      if (o.profile?.hub) tags.appendChild(h("span", { class: "tag" }, "Hub org"));
      const sec = sectorById(o.sector);
      if (sec) tags.appendChild(h("span", { class: "tag sector-pill", style: `--sector:${sec.color}` }, sec.label));
      if (o.profile?.geo_precision === "approx") tags.appendChild(h("span", { class: "tag" }, "Approximate location"));
      for (const t of o.topic_tags || []) tags.appendChild(h("span", { class: "tag" }, prettifyTag(t)));
      if (tags.childNodes.length) head.appendChild(tags);
      const edit = formUrl("org", node);
      if (edit) {
        head.appendChild(
          h("a", { class: "edit-link", href: edit, target: "_blank", rel: "noopener" }, "✎ Update this organization's info"),
        );
      }
      head.appendChild(
        h(
          "div",
          { class: "meta" },
          metaCell(o.coalition_ids.length, "Coalitions"),
          metaCell(relTime(o.last_activity), "Last updated"),
        ),
      );
    }
    return head;
  }

  function metaCell(val: string | number, lbl: string): HTMLElement {
    return h(
      "div",
      { class: "cell" },
      h("div", { class: "val" }, String(val)),
      h("div", { class: "lbl" }, lbl),
    );
  }

  function prettifyTag(t: string): string {
    return t.replace(/_/g, " ");
  }

  function renderTabs(node: GraphNode): HTMLElement {
    const tabs = h("div", { class: "drawer-tabs" });
    const n = {
      projects: node.kind === "coalition" ? node.projects.length : orgProjects(data, node).length,
      events: node.kind === "coalition" ? node.events.length : orgEvents(data, node).length,
      actions: node.kind === "coalition" ? node.actions.length : orgActions(data, node).length,
    };
    const tabList: { id: DrawerTab; label: string }[] =
      node.kind === "coalition"
        ? [
            { id: "about", label: "About" },
            { id: "projects", label: `Projects (${n.projects})` },
            { id: "events", label: `Events (${n.events})` },
            { id: "actions", label: `Actions (${n.actions})` },
          ]
        : [
            { id: "about", label: "About" },
            { id: "projects", label: `Projects (${n.projects})` },
            { id: "events", label: `Events (${n.events})` },
            { id: "actions", label: `Actions (${n.actions})` },
          ];
    // Ensure activeTab is valid for this node kind
    if (!tabList.find((t) => t.id === activeTab)) {
      activeTab = tabList[0].id;
    }
    for (const t of tabList) {
      const btn = h(
        "button",
        {
          class: `drawer-tab ${t.id === activeTab ? "active" : ""}`,
        },
        t.label,
      );
      btn.addEventListener("click", () => api.setActiveTab(t.id));
      tabs.appendChild(btn);
    }
    return tabs;
  }

  function renderBody(node: GraphNode): HTMLElement {
    const body = h("div", { class: "body" });
    if (node.kind === "coalition") {
      const c = node as Coalition;
      if (activeTab === "about") {
        renderCoalitionAbout(body, c);
      } else if (activeTab === "projects") {
        renderProjects(body, c.projects, node);
      } else if (activeTab === "events") {
        renderEvents(body, c.events, node);
      } else if (activeTab === "actions") {
        renderActions(body, c.actions, node);
      }
    } else {
      const o = node as Organization;
      if (activeTab === "coalitions") {
        // Connections: coalitions, orgs they work with, then suggested connections at the end.
        renderCoalitionList(body, o);
        body.appendChild(h("div", { class: "section-label" }, "Suggested connections"));
        renderSuggestions(body, o);
      } else if (activeTab === "suggested") {
        renderSuggestions(body, o);
      } else if (activeTab === "projects") {
        renderProjects(body, orgProjects(data, o), node);
      } else if (activeTab === "events") {
        renderEvents(body, orgEvents(data, o), node);
      } else if (activeTab === "actions") {
        renderActions(body, orgActions(data, o), node);
      } else if (activeTab === "about") {
        renderOrgAbout(body, o);
        // Connections live at the end of About (they used to be a fifth tab that wrapped the tab row).
        body.appendChild(h("div", { class: "section-label" }, "Connections"));
        renderCoalitionList(body, o);
        body.appendChild(h("div", { class: "section-label" }, "Suggested connections"));
        renderSuggestions(body, o);
      }
    }
    return body;
  }


  function renderProjects(body: HTMLElement, items: Project[], owner: GraphNode): void {
    if (!items.length) {
      body.appendChild(h("div", { class: "empty" }, "No active projects."));
      return;
    }
    for (const p of items) {
      body.appendChild(
        h(
          "div",
          { class: "item" },
          openName("project", p, owner),
          h("div", { class: "desc" }, p.description),
          h(
            "div",
            { class: "row" },
            h("span", { class: "pill kind" }, p.status),
          ),
          itemButtons("project", p),
          staleNotice("project", owner, p.needs_info, p.verified, p),
        ),
      );
    }
  }

  function renderEvents(body: HTMLElement, items: CoalitionEvent[], owner: GraphNode): void {
    if (!items.length) {
      body.appendChild(h("div", { class: "empty" }, "No upcoming events."));
      return;
    }
    for (const e of items) {
      body.appendChild(
        h(
          "div",
          { class: "item" },
          openName("event", e, owner),
          h(
            "div",
            { class: "row" },
            h("span", { class: "pill deadline" }, fmtEventTime(e.date, e.end, e.recurrence)),
            e.location ? h("span", { class: "pill kind" }, e.location) : null,
          ),
          itemButtons("event", e),
          staleNotice("event", owner, e.needs_info, e.verified, e),
        ),
      );
    }
  }

  function renderActions(body: HTMLElement, items: Action[], owner: GraphNode): void {
    if (!items.length) {
      body.appendChild(h("div", { class: "empty" }, "No open actions."));
      return;
    }
    for (const a of items) {
      const row = h(
        "div",
        { class: "row" },
        h("span", { class: "pill kind" }, a.kind === "role" ? "volunteer role" : "action"),
      );
      if (a.urgency) row.appendChild(h("span", { class: `pill ${a.urgency}` }, `${a.urgency} urgency`));
      if (a.deadline) {
        row.appendChild(
          h("span", { class: "pill deadline" }, `by ${a.deadline}`),
        );
      }
      for (const s of a.skills_needed) {
        row.appendChild(h("span", { class: "pill skill" }, s));
      }
      body.appendChild(
        h(
          "div",
          { class: "item" },
          openName("action", a, owner),
          a.description ? h("div", { class: "desc" }, a.description) : null,
          row,
          itemButtons("action", a),
          staleNotice("action", owner, a.needs_info, a.verified, a),
        ),
      );
    }
  }

  function renderSuggestions(body: HTMLElement, org: Organization): void {
    const list = suggestionsFor(data, org.id);
    body.appendChild(
      h("div", { class: "section-note" },
        "Organizations doing similar work that haven't said they work together. Suggestions improve as groups add descriptions and topics."),
    );
    if (!list.length) {
      body.appendChild(h("div", { class: "empty" }, "No suggestions yet."));
      return;
    }
    for (const { other, s } of list) {
      const o = orgsById.get(other);
      if (!o) continue;
      const row = h(
        "div",
        { class: "item clickable" },
        h("div", { class: "name" }, o.name),
        h("div", { class: "desc" }, s.reasons.join(" · ") + (s.sharedCoalition ? " · Already share a coalition" : "")),
        h("div", { class: "row" }, h("span", { class: "pill" }, `${Math.round(s.score * 100)}% match`)),
      );
      row.addEventListener("click", () => cb.onOrgClick?.(other));
      body.appendChild(row);
    }
  }

  function renderOrgLinks(body: HTMLElement, org: Organization): void {
    const FREQ: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", few_per_year: "A few times a year", yearly: "Yearly or less" };
    const links = (data.org_links || [])
      .filter((l) => l.source === org.id || l.target === org.id)
      .sort((x, y) => y.weight - x.weight);
    body.appendChild(h("div", { class: "section-label" }, `Works with (${links.length})`));
    if (!links.length) {
      body.appendChild(h("div", { class: "empty" }, "No organizations reported yet."));
      return;
    }
    for (const l of links) {
      const otherId = l.source === org.id ? l.target : l.source;
      const o = orgsById.get(otherId);
      if (!o) continue;
      const row = h(
        "div",
        { class: "coalition-link" },
        h("div", { class: "dot", style: `background:#9ca3af;opacity:${0.4 + l.weight * 0.15}` }),
        h("div", {}, h("div", { class: "name", style: "font-size:13px" }, o.name),
          h("div", { class: "sub", style: "font-size:11px;color:#6b7280" }, FREQ[l.frequency] || l.frequency)),
      );
      row.addEventListener("click", () => cb.onOrgClick?.(otherId));
      body.appendChild(row);
    }
  }

  function renderCoalitionList(body: HTMLElement, org: Organization): void {
    body.appendChild(h("div", { class: "section-label" }, `Coalitions (${org.coalition_ids.length})`));
    if (!org.coalition_ids.length) {
      body.appendChild(
        h("div", { class: "empty" }, "Not currently in any coalition."),
      );
      renderOrgLinks(body, org);
      return;
    }
    for (const cid of org.coalition_ids) {
      const c = coalitionsById.get(cid);
      if (!c) continue;
      const row = h(
        "div",
        { class: "coalition-link" },
        h("div", { class: "dot", style: `background:${c.color}` }),
        h(
          "div",
          {},
          h("div", { class: "name", style: "font-size:13px" }, c.name),
          h(
            "div",
            { class: "sub", style: "font-size:11px;color:#6b7280" },
            `${c.member_count} member ${c.member_count === 1 ? "group" : "groups"}`,
          ),
        ),
      );
      row.addEventListener("click", () => cb.onCoalitionClick?.(cid));
      body.appendChild(row);
    }
    renderOrgLinks(body, org);
  }

  function renderCoalitionAbout(body: HTMLElement, c: Coalition): void {
    const row = (name: string, value: string | Node | undefined | null) => {
      if (value === undefined || value === null || value === "") return;
      body.appendChild(h("div", { class: "item" }, h("div", { class: "name" }, name), h("div", { class: "desc" }, value)));
    };
    row("Type", "Coalition");
    row("Geographic scope", c.geographic_scope ? c.geographic_scope[0].toUpperCase() + c.geographic_scope.slice(1) : "");
    row("Description", c.description);
    row("Website", c.website ? h("a", { class: "org-website", href: c.website, target: "_blank", rel: "noopener noreferrer" }, c.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) : undefined);
    row("Focus", c.focus_tags.length ? c.focus_tags.map(prettifyTag).join(", ") : "");
    const members = c.member_ids.map((id) => data.organizations.find((o) => o.id === id)).filter((o): o is Organization => !!o)
      .sort((a, b) => a.name.localeCompare(b.name));
    body.appendChild(h("div", { class: "section-label" }, `Member groups (${members.length})`));
    if (!members.length) body.appendChild(h("div", { class: "empty" }, "No member groups listed yet."));
    for (const o of members) {
      const r = h("div", { class: "item clickable" }, h("div", { class: "name" }, o.name), o.geographic_focus ? h("div", { class: "sub" }, o.geographic_focus) : null);
      r.addEventListener("click", () => cb.onOrgClick?.(o.id));
      body.appendChild(r);
    }
  }

  function renderOrgAbout(body: HTMLElement, org: Organization): void {
    const row = (name: string, value: string | Node | undefined | null) => {
      if (value === undefined || value === null || value === "") return;
      body.appendChild(h("div", { class: "item" }, h("div", { class: "name" }, name), h("div", { class: "desc" }, value)));
    };
    const score = (v?: number) => (v === undefined ? undefined : `${v} / 4`);
    const p = org.profile || {};
    row("Type", typeLabel(org.type));
    row("Geographic focus", org.geographic_focus);
    row("Description", org.description);
    row("Website", org.website ? h("a", { class: "org-website", href: org.website, target: "_blank", rel: "noopener noreferrer" }, org.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) : undefined);
    row("Contact", org.public_contact);
    row("Active membership", p.membership_size);
    row("EJ / frontline focus", score(p.ej_focus));
    row("Grassroots power", score(p.grassroots));
    row("Policy writing", score(p.policy_expertise));
    row("“In the building”", score(p.in_building));
    if (!body.childNodes.length) body.appendChild(h("div", { class: "empty" }, "No details yet."));
  }

  // suppress unused-import warning
  void orgsById;

  /** An item's name in a list: click it for the full view. */
  function openName(kind: ItemKind, item: CoalitionEvent | Project | Action, owner: GraphNode): HTMLElement {
    const n = h("button", { class: "name item-open", type: "button", title: "See all the details" }, item.name, h("span", { class: "item-open-more" }, " ›"));
    n.addEventListener("click", () => api.openItem(kind, item, owner));
    return n;
  }

  // ----- Full view of one event / project / action -----
  type TopicsFile = { parents: { id: string; label: string; children: { id: string; label: string }[] }[]; records: { id: string; topics: string[]; bills: string[] }[] };
  let topicsData: TopicsFile | null = null;
  let topicsLoading: Promise<void> | null = null;
  function loadTopics(): Promise<void> {
    if (topicsData || topicsLoading) return topicsLoading ?? Promise.resolve();
    topicsLoading = fetch(`${import.meta.env.BASE_URL}topics.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { topicsData = j; }).catch(() => {});
    return topicsLoading;
  }
  function topicLabels(itemId: string): string[] {
    if (!topicsData) return [];
    const rec = topicsData.records.find((r) => r.id.endsWith(`:${itemId}`));
    if (!rec) return [];
    const label = new Map<string, string>();
    for (const p of topicsData.parents) for (const c of p.children) label.set(c.id, c.label);
    return rec.topics.filter((t) => t !== "broad").map((t) => label.get(t) || t);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  function eventTimes(e: CoalitionEvent): { start: Date; end: Date } | null {
    if (!e.date) return null;
    const start = new Date(e.date);
    if (isNaN(start.getTime())) return null;
    const end = e.end && !isNaN(new Date(e.end).getTime()) ? new Date(e.end) : new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  }
  /** "Add to Google Calendar" and an .ics file for Apple / Outlook. Times are Massachusetts time. */
  function calendarLinks(e: CoalitionEvent, owner: GraphNode): HTMLElement | null {
    const t = eventTimes(e);
    if (!t) return null;
    const details = [e.description, e.link ? `More: ${e.link}` : "", `Hosted by ${owner.name}`].filter(Boolean).join("\n\n");
    const g = new URL("https://calendar.google.com/calendar/render");
    g.searchParams.set("action", "TEMPLATE");
    g.searchParams.set("text", e.name);
    g.searchParams.set("dates", `${stamp(t.start)}/${stamp(t.end)}`);
    g.searchParams.set("ctz", "America/New_York");
    g.searchParams.set("details", details);
    if (e.location) g.searchParams.set("location", e.location);
    const esc = (v: string) => v.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MA Climate Coalition Map//EN", "BEGIN:VEVENT",
      `UID:${e.id}@openthink-map`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART;TZID=America/New_York:${stamp(t.start)}`, `DTEND;TZID=America/New_York:${stamp(t.end)}`,
      `SUMMARY:${esc(e.name)}`, e.location ? `LOCATION:${esc(e.location)}` : "", `DESCRIPTION:${esc(details)}`,
      e.link ? `URL:${e.link}` : "", "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
    const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    const file = `${e.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event"}.ics`;
    return h("div", { class: "item-cal" },
      h("a", { class: "btn-cal", href: g.toString(), target: "_blank", rel: "noopener noreferrer" }, "+ Google Calendar"),
      h("a", { class: "btn-cal", href: icsHref, download: file }, "+ Apple / Outlook (.ics)"));
  }

  function renderItem(kind: ItemKind, item: CoalitionEvent | Project | Action, owner: GraphNode): void {
    const back = h("button", { class: "item-back", type: "button" }, `← ${owner.name}`);
    back.addEventListener("click", () => { currentItem = null; rerender(); });
    const closeBtn = h("button", { class: "close", type: "button", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", () => api.close());
    const e = item as CoalitionEvent, p = item as Project, a = item as Action;
    const kindLabel = kind === "event" ? (e.recurrence ? "Event · repeats" : "Event")
      : kind === "project" ? `Project · ${p.status || "active"}`
      : a.kind === "role" ? "Volunteer role" : "Action";
    const head = h("div", { class: "head item-head" },
      h("div", { class: "item-top" }, back, closeBtn),
      h("div", { class: `item-kind k-${kind}` }, kindLabel),
      h("h2", {}, item.name));
    el.appendChild(head);

    const body = h("div", { class: "body item-detail" });
    const row = (name: string, value: string | Node | undefined | null) => {
      if (value === undefined || value === null || value === "") return;
      body.appendChild(h("div", { class: "item" }, h("div", { class: "name" }, name), h("div", { class: "desc" }, value)));
    };
    if (kind === "event") {
      row("When", fmtEventTime(e.date, e.end, e.recurrence));
      if (e.recurrence) row("Repeats", e.recurrence);
    }
    const loc = kind === "event" ? e.location : kind === "project" ? p.location : "";
    if (loc) {
      const online = /^online/i.test(loc) || (kind === "event" && e.online);
      row("Where", online ? loc : h("span", {}, loc, " · ",
        h("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, target: "_blank", rel: "noopener noreferrer" }, "Open in maps ↗")));
    } else if (kind === "event" && e.online) row("Where", "Online");
    if (kind === "action") {
      if (a.deadline) row("Deadline", a.deadline);
      if (a.urgency) row("Urgency", a.urgency);
      if (a.skills_needed?.length) row("Skills that help", a.skills_needed.join(", "));
    }
    row("About", item.description || "");
    const btns = itemButtons(kind, item as { rsvp_link?: string; link?: string });
    if (btns) body.appendChild(btns);
    if (kind === "event") { const cal = calendarLinks(e, owner); if (cal) body.appendChild(cal); }
    const contact = (item as { public_contact?: string }).public_contact;
    if (contact) row("Contact", contact);

    const hostRow = h("div", { class: "item clickable host-row" },
      h("div", { class: "name" }, owner.kind === "coalition" ? "Coalition" : "Hosted by"),
      h("div", { class: "desc" }, owner.name, " ›"));
    hostRow.addEventListener("click", () => { currentItem = null; activeTab = "about"; rerender(); });
    body.appendChild(hostRow);

    const topicsBox = h("div", { class: "item item-topics" });
    const fillTopics = () => {
      clear(topicsBox);
      const labels = topicLabels(item.id);
      if (!labels.length) { topicsBox.remove(); return; }
      topicsBox.append(h("div", { class: "name" }, "Topics"), h("div", { class: "tags" }, ...labels.map((l) => h("span", { class: "tag" }, l))));
    };
    body.appendChild(topicsBox);
    if (topicsData) fillTopics(); else loadTopics().then(() => { if (currentItem?.item === item) fillTopics(); });

    body.appendChild(staleNotice(kind, owner, (item as { needs_info?: boolean }).needs_info, (item as { verified?: boolean }).verified, item as never));

    const more = [
      ...(owner.kind === "coalition" ? owner.events : orgEvents(data, owner as Organization)).map((x) => ({ kind: "event" as ItemKind, x })),
      ...(owner.kind === "coalition" ? owner.projects : orgProjects(data, owner as Organization)).map((x) => ({ kind: "project" as ItemKind, x })),
      ...(owner.kind === "coalition" ? owner.actions : orgActions(data, owner as Organization)).map((x) => ({ kind: "action" as ItemKind, x })),
    ].filter((m) => m.x.id !== item.id).slice(0, 5);
    if (more.length) {
      body.appendChild(h("div", { class: "section-label" }, `More from ${owner.name}`));
      for (const m of more) {
        const r = h("div", { class: "item clickable" },
          h("div", { class: "name" }, m.x.name),
          h("div", { class: "sub" }, m.kind === "event" ? fmtEventTime((m.x as CoalitionEvent).date, (m.x as CoalitionEvent).end, (m.x as CoalitionEvent).recurrence) : m.kind === "project" ? "Project" : "Action"));
        r.addEventListener("click", () => api.openItem(m.kind, m.x, owner));
        body.appendChild(r);
      }
    }
    el.appendChild(body);
  }

  function rerender() {
    if (!currentNode) return;
    clear(el);
    if (currentItem) { renderItem(currentItem.kind, currentItem.item, currentNode); return; }
    el.appendChild(renderHead(currentNode));
    el.appendChild(renderTabs(currentNode));
    el.appendChild(renderBody(currentNode));
  }

  const api: Drawer = {
    open(node) {
      currentNode = node;
      currentItem = null;
      // Every group opens on its About tab.
      activeTab = "about";
      rerender();
      el.classList.add("open");
    },
    close() {
      el.classList.remove("open");
      currentNode = null;
    },
    current() {
      return el.classList.contains("open") ? currentNode : null;
    },
    isOpen() {
      return el.classList.contains("open");
    },
    setActiveTab(tab) {
      activeTab = tab;
      rerender();
    },
    openItem(kind, item, owner) {
      currentNode = owner;
      currentItem = { kind, item };
      activeTab = kind === "event" ? "events" : kind === "project" ? "projects" : "actions";
      rerender();
      el.classList.add("open");
      el.scrollTop = 0;
    },
  };

  return api;
}
