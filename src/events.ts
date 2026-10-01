import type { DataFile, CoalitionEvent, GraphNode } from "./types";
import { allEvents, ownerBadge, type Owner } from "./owners";
import { h, clear } from "./dom";
import { staleNotice } from "./notice";
import { occursOn, parseRecurrence } from "./recurrence";
import { fmtEventTime, hasTime, parseEventDate } from "./util";

export interface EventsView {
  el: HTMLElement;
  refresh(): void;
}

export interface EventsCallbacks {
  onCoalitionClick(node: GraphNode): void;
}

type TimeFilter = "all" | "upcoming" | "past";

interface Row {
  event: CoalitionEvent;
  owner: Owner;
  isUpcoming: boolean;
}

export function createEventsView(
  data: DataFile,
  cb: EventsCallbacks,
): EventsView {
  const wrap = h("div", { class: "list-view" });

  // Flatten and tag every event with the coalition or org it belongs to
  const now = Date.now();
  const rows: Row[] = allEvents(data).map(({ event, owner }) => ({
    event,
    owner,
    isUpcoming: !!event.recurrence || parseEventDate(event.date).getTime() + (hasTime(event.date) ? 0 : 86400000) >= now,
  }));
  rows.sort((a, b) => {
    if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
    return parseEventDate(a.event.date).getTime() - parseEventDate(b.event.date).getTime();
  });

  let q = "";
  let timeFilter: TimeFilter = "upcoming";

  // ---- Toolbar ----
  const toolbar = h("div", { class: "list-toolbar" });
  toolbar.appendChild(h("h2", {}, "Events"));
  const count = h("span", { class: "count" }, "");
  toolbar.appendChild(count);

  const search = h("input", {
    class: "search",
    type: "search",
    placeholder: "Search events, locations, coalitions, or orgs…",
  }) as HTMLInputElement;
  search.addEventListener("input", () => {
    q = search.value.trim().toLowerCase();
    render();
  });
  toolbar.appendChild(search);

  const filters = h("div", { class: "filters" });
  const filterDefs: { id: TimeFilter; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "past", label: "Past" },
    { id: "all", label: "All" },
  ];
  const chipEls = new Map<TimeFilter, HTMLElement>();
  for (const f of filterDefs) {
    const chip = h(
      "button",
      {
        class: `chip ${timeFilter === f.id ? "active" : ""}`,
      },
      f.label,
    );
    chip.addEventListener("click", () => {
      timeFilter = f.id;
      for (const [id, el] of chipEls) el.classList.toggle("active", id === timeFilter);
      render();
    });
    chipEls.set(f.id, chip);
    filters.appendChild(chip);
  }
  toolbar.appendChild(filters);

  // List / Calendar toggle
  let mode: "list" | "calendar" = "list";
  const modes = h("div", { class: "filters view-modes" });
  const modeEls = new Map<string, HTMLElement>();
  for (const m of [["list", "List"], ["calendar", "Calendar"]] as const) {
    const b = h("button", { class: `chip ${mode === m[0] ? "active" : ""}` }, m[1]);
    b.addEventListener("click", () => {
      mode = m[0];
      for (const [id, el] of modeEls) el.classList.toggle("active", id === mode);
      filters.style.display = mode === "list" ? "" : "none";
      render();
    });
    modeEls.set(m[0], b);
    modes.appendChild(b);
  }
  toolbar.appendChild(modes);
  wrap.appendChild(toolbar);

  // ---- Body ----
  const body = h("div", { class: "list-body" });
  wrap.appendChild(body);

  // ---- Calendar ----
  let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDay = "";
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function renderCalendar() {
    const visible = rows.filter((r) => {
      if (!q) return true;
      return (
        r.event.name.toLowerCase().includes(q) ||
        r.event.location.toLowerCase().includes(q) ||
        r.owner.name.toLowerCase().includes(q) ||
        r.owner.abbrev.toLowerCase().includes(q)
      );
    });
    const calWrap = h("div", { class: "cal-wrap" });
    body.appendChild(calWrap);
    // Every day of the 6-week grid, with the events that land on it (recurring ones expanded).
    const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay());
    const byDay = new Map<string, Row[]>();
    const add = (k: string, r: Row) => (byDay.get(k) || byDay.set(k, []).get(k)!).push(r);
    for (const r of visible) {
      const anchor = parseEventDate(r.event.date);
      const rule = r.event.recurrence ? parseRecurrence(r.event.recurrence) : null;
      if (!rule) { add(dayKey(anchor), r); continue; }
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        if (occursOn(rule, anchor, d)) add(dayKey(d), r);
      }
    }
    let inMonth = 0;
    for (const [k, rs] of byDay) if (k.startsWith(`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`)) inMonth += rs.length;
    count.textContent = `${inMonth} event${inMonth === 1 ? "" : "s"} this month`;

    const nav = h("div", { class: "cal-nav" });
    const prev = h("button", { class: "chip" }, "‹");
    const next = h("button", { class: "chip" }, "›");
    const today = h("button", { class: "chip" }, "Today");
    prev.addEventListener("click", () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1); render(); });
    next.addEventListener("click", () => { monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1); render(); });
    today.addEventListener("click", () => { const n = new Date(); monthStart = new Date(n.getFullYear(), n.getMonth(), 1); selectedDay = dayKey(n); render(); });
    nav.append(prev, h("span", { class: "cal-title" }, monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })), next, today);
    calWrap.appendChild(nav);

    const grid = h("div", { class: "cal-grid" });
    for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) grid.appendChild(h("div", { class: "cal-dow" }, d));
    const first = gridStart;
    const todayKey = dayKey(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const k = dayKey(d);
      const evs = byDay.get(k) || [];
      const cell = h("div", { class: `cal-day ${d.getMonth() !== monthStart.getMonth() ? "other" : ""} ${k === todayKey ? "today" : ""} ${k === selectedDay ? "selected" : ""}` }, h("div", { class: "cal-num" }, String(d.getDate())));
      for (const r of evs.slice(0, 3)) {
        const chip = h("div", { class: "cal-ev", style: `border-left-color:${r.owner.color}`, title: r.event.name }, (r.event.recurrence ? "↻ " : "") + r.event.name);
        chip.addEventListener("click", (ev) => { ev.stopPropagation(); selectedDay = k; showDetail(r); });
        cell.appendChild(chip);
      }
      if (evs.length > 3) cell.appendChild(h("div", { class: "cal-more" }, `+${evs.length - 3} more`));
      if (evs.length) {
        const dots = h("div", { class: "cal-dots" });
        for (const r of evs.slice(0, 6)) dots.appendChild(h("i", { style: `background:${r.owner.color}` }));
        cell.appendChild(dots);
      }
      cell.addEventListener("click", () => { selectedDay = k; render(); });
      grid.appendChild(cell);
    }
    calWrap.appendChild(grid);

    const dayRows = byDay.get(selectedDay) || [];
    if (selectedDay) {
      const label = parseEventDate(selectedDay).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      calWrap.appendChild(h("h3", { class: "cal-day-title" }, dayRows.length ? label : `${label} — no events`));
      const dayList = h("div", { class: "cal-day-list" });
      for (const r of dayRows) dayList.appendChild(eventCard(r));
      calWrap.appendChild(dayList);
    } else {
      calWrap.appendChild(h("div", { class: "list-empty" }, "Pick a day to see its events. Recurring events (↻) repeat on their schedule from their next date on."));
    }
  }

  function matches(r: Row): boolean {
    if (timeFilter === "upcoming" && !r.isUpcoming) return false;
    if (timeFilter === "past" && r.isUpcoming) return false;
    if (!q) return true;
    return (
      r.event.name.toLowerCase().includes(q) ||
      r.event.location.toLowerCase().includes(q) ||
      r.owner.name.toLowerCase().includes(q) ||
      r.owner.abbrev.toLowerCase().includes(q)
    );
  }

  function render() {
    clear(body);
    if (mode === "calendar") return renderCalendar();
    const filtered = rows.filter(matches);
    count.textContent = `${filtered.length} event${filtered.length === 1 ? "" : "s"}`;
    if (!filtered.length) {
      body.appendChild(h("div", { class: "list-empty" }, "No events match."));
      return;
    }
    for (const r of filtered) body.appendChild(eventCard(r));
  }

  /** A detail card over the Events tab: everything we know about the event, without leaving the page. */
  function showDetail(r: Row) {
    wrap.querySelectorAll(".detail-overlay").forEach((n) => n.remove());
    const e = r.event;
    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
    const x = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
    x.addEventListener("click", close);
    const toMap = h("button", { class: "detail-map-btn", type: "button" }, `See ${r.owner.name} on the map`);
    toMap.addEventListener("click", () => { close(); cb.onCoalitionClick(r.owner.node); });
    const safe = (u?: string) => !!u && /^https?:\/\//.test(u);
    const card = h("div", { class: "detail-card", role: "dialog", "aria-label": e.name },
      x,
      h("div", { class: "head" },
        ownerBadge(r.owner),
        h("div", { class: "coalition-name" }, r.owner.name)),
      h("h3", {}, e.name),
      h("div", { class: "meta-row" },
        h("span", { class: "pill deadline" }, fmtEventTime(e.date, e.end, e.recurrence)),
        e.location ? h("span", { class: "pill kind" }, e.location) : null,
        e.online ? h("span", { class: "pill" }, "online") : null,
        !r.isUpcoming ? h("span", { class: "pill" }, "past") : null),
      e.description ? h("p", { class: "detail-desc" }, e.description) : null,
      e.topic_tags && e.topic_tags.length ? h("div", { class: "detail-tags" }, e.topic_tags.map((t) => t.replace(/_/g, " ")).join(" · ")) : null,
      e.public_contact ? h("div", { class: "detail-contact" }, `Contact: ${e.public_contact}`) : null,
      h("div", { class: "detail-links" },
        safe(e.rsvp_link) ? h("a", { class: "item-link rsvp-link", href: e.rsvp_link, target: "_blank", rel: "noopener noreferrer" }, "RSVP ↗") : null,
        safe(e.link) ? h("a", { class: "item-link", href: e.link, target: "_blank", rel: "noopener noreferrer" }, "More info ↗") : null),
      staleNotice("event", r.owner.node, e.needs_info, e.verified, e),
      toMap);
    const overlay = h("div", { class: "detail-overlay" }, card);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);
    wrap.appendChild(overlay);
    x.focus();
  }

  function eventCard(r: Row): HTMLElement {
      const card = h(
        "div",
        { class: "list-card" },
        h(
          "div",
          { class: "head" },
          ownerBadge(r.owner),
          h("div", { class: "coalition-name" }, r.owner.name),
        ),
        h("div", { class: "name" }, r.event.name),
        h(
          "div",
          { class: "meta-row" },
          h("span", { class: "pill deadline" }, fmtEventTime(r.event.date, r.event.end, r.event.recurrence)),
          h("span", { class: "pill kind" }, r.event.location),
          !r.isUpcoming && h("span", { class: "pill" }, "past"),
        ),
        r.event.rsvp_link && /^https?:\/\//.test(r.event.rsvp_link)
          ? h("a", { class: "item-link rsvp-link", href: r.event.rsvp_link, target: "_blank", rel: "noopener noreferrer" }, "RSVP ↗")
          : null,
        r.event.link && /^https?:\/\//.test(r.event.link)
          ? h("a", { class: "item-link", href: r.event.link, target: "_blank", rel: "noopener noreferrer", onclick: "" }, "More info ↗")
          : null,
        staleNotice("event", r.owner.node, r.event.needs_info, r.event.verified, r.event),
      );
      card.querySelectorAll("a").forEach((a) => a.addEventListener("click", (ev) => ev.stopPropagation()));
      card.addEventListener("click", () => showDetail(r));
      return card;
  }

  render();
  return { el: wrap, refresh: render };
}
