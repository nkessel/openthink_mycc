import type { DataFile, CoalitionEvent, GraphNode } from "./types";
import { allEvents, ownerBadge, type Owner, sectorAttrs, sectorPill } from "./owners";
import { itemButtons } from "./links";
import { showItemCard } from "./itemcard";
import { h, clear } from "./dom";
import { staleNotice } from "./notice";
import { occursOn, parseRecurrence } from "./recurrence";
import { fmtEventTime, hasTime, parseEventDate } from "./util";
import { createItemFilters, placeFor, termsMatch, type Facts } from "./itemfilters";

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
    placeholder: "Search topics, names, places… (separate with commas)",
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

  // ---- Filters: zip + miles, online, in view on the map, free food, public / affiliated-only, date + time range ----
  const itemFilters = createItemFilters({ online: true, inView: true, freeFood: true, publicSwitch: true }, () => render());
  // When: one tap for the usual ranges, or "Pick dates…" for two plain date boxes; and a time of day.
  let rangeFrom = "";
  let rangeTo = "";
  let whenId = "any";
  let partOfDay: "any" | "morning" | "afternoon" | "evening" = "any";
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayStart = (d: Date) => `${ymd(d)}T00:00`;
  const dayEnd = (d: Date) => `${ymd(d)}T23:59`;
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const WHEN: { id: string; label: string; range?: () => [string, string] }[] = [
    { id: "any", label: "Any date" },
    { id: "today", label: "Today", range: () => [dayStart(new Date()), dayEnd(new Date())] },
    { id: "tomorrow", label: "Tomorrow", range: () => [dayStart(addDays(new Date(), 1)), dayEnd(addDays(new Date(), 1))] },
    { id: "weekend", label: "This weekend", range: () => {
      const t = new Date(), dow = t.getDay(); // Sat 6, Sun 0
      const sat = dow === 0 ? addDays(t, -1) : addDays(t, 6 - dow);
      return [dayStart(dow === 0 ? t : sat), dayEnd(addDays(sat, 1))];
    } },
    { id: "week", label: "Next 7 days", range: () => [dayStart(new Date()), dayEnd(addDays(new Date(), 6))] },
    { id: "month", label: "Next 30 days", range: () => [dayStart(new Date()), dayEnd(addDays(new Date(), 29))] },
    { id: "custom", label: "Pick dates…" },
  ];
  const fromIn = h("input", { type: "date", class: "search range-in", "aria-label": "From date" }) as HTMLInputElement;
  const toIn = h("input", { type: "date", class: "search range-in", "aria-label": "Until date" }) as HTMLInputElement;
  const custom = h("div", { class: "when-custom" }, h("span", { class: "range-lbl" }, "From"), fromIn, h("span", { class: "range-lbl" }, "to"), toIn);
  custom.style.display = "none";
  const applyCustom = () => {
    if (fromIn.value && toIn.value && toIn.value < fromIn.value) toIn.value = fromIn.value;
    rangeFrom = fromIn.value ? `${fromIn.value}T00:00` : "";
    rangeTo = toIn.value ? `${toIn.value}T23:59` : "";
    render();
  };
  fromIn.addEventListener("change", applyCustom); // "to" left empty = from that day on
  toIn.addEventListener("change", applyCustom);
  const whenChips = h("div", { class: "when-chips", role: "group", "aria-label": "When" });
  const whenBtns: HTMLButtonElement[] = [];
  for (const w of WHEN) {
    const b = h("button", { class: `chip ${w.id === whenId ? "active" : ""}`, type: "button", "aria-pressed": String(w.id === whenId) }, w.label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      whenId = w.id;
      for (const x of whenBtns) { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); }
      custom.style.display = w.id === "custom" ? "" : "none";
      if (w.id === "custom") { applyCustom(); fromIn.focus(); return; }
      [rangeFrom, rangeTo] = w.range ? w.range() : ["", ""];
      // a date range ahead of today implies upcoming events
      if (w.range && timeFilter === "past") chipEls.get("all")?.click();
      render();
    });
    whenBtns.push(b);
    whenChips.appendChild(b);
  }
  const dayParts = h("div", { class: "when-chips", role: "group", "aria-label": "Time of day" });
  const partBtns: HTMLButtonElement[] = [];
  for (const [id, label] of [["any", "Any time"], ["morning", "Mornings"], ["afternoon", "Afternoons"], ["evening", "Evenings"]] as const) {
    const b = h("button", { class: `chip ${id === partOfDay ? "active" : ""}`, type: "button", "aria-pressed": String(id === partOfDay) }, label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      partOfDay = id;
      for (const x of partBtns) { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); }
      render();
    });
    partBtns.push(b);
    dayParts.appendChild(b);
  }
  itemFilters.el.append(h("div", { class: "filter-group when-group" }, h("span", { class: "range-lbl" }, "When"), whenChips, custom, dayParts));
  wrap.appendChild(itemFilters.el);

  const factsOf = (r: Row): Facts => ({
    hay: `${r.event.name} ${r.event.location || ""} ${r.event.description || ""} ${(r.event.topic_tags || []).join(" ")} ${r.owner.name} ${r.owner.abbrev}`,
    ...placeFor(r.event, r.owner.node as { lat?: number; lng?: number; remote?: boolean; kind?: string }), online: r.event.online,
    free_food: r.event.free_food, affiliated_only: r.event.affiliated_only,
  });

  /** Does the event (or, if it repeats, one of its occurrences) fall inside the chosen date + time range? */
  function inRange(r: Row): boolean {
    if (!rangeFrom && !rangeTo) return true;
    const from = rangeFrom ? new Date(rangeFrom) : null;
    const to = rangeTo ? new Date(rangeTo) : null;
    const start = parseEventDate(r.event.date);
    const rule = r.event.recurrence ? parseRecurrence(r.event.recurrence) : null;
    const ok = (t: Date) => (!from || t >= from) && (!to || t <= to);
    if (!rule) return ok(start);
    // Repeating: look at each day in the range (capped at a year) and compare the time of day.
    const first = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate()) : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    for (let i = 0; i < 366; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      if (to && d > to) break;
      if (!occursOn(rule, start, d)) continue;
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), start.getHours(), start.getMinutes());
      if (ok(t)) return true;
    }
    return false;
  }

  // ---- Body ----
  const body = h("div", { class: "list-body" });
  wrap.appendChild(body);

  // ---- Calendar ----
  let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDay = "";
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function renderCalendar() {
    const visible = rows.filter((r) => (!q || termsMatch(q, factsOf(r).hay)) && itemFilters.test(factsOf(r)));
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
      // Sector layers (Social justice) sit under the climate events of the day, so they never crowd them out.
      const evs = (byDay.get(k) || []).slice().sort((x, y) => Number(!!x.owner.node.sector) - Number(!!y.owner.node.sector));
      const cell = h("div", { class: `cal-day ${d.getMonth() !== monthStart.getMonth() ? "other" : ""} ${k === todayKey ? "today" : ""} ${k === selectedDay ? "selected" : ""}` }, h("div", { class: "cal-num" }, String(d.getDate())));
      for (const r of evs.slice(0, 3)) {
        const chip = h("div", { class: `cal-ev${sectorAttrs(r.owner).cls}`, style: `border-left-color:${r.owner.color}`, title: r.event.name }, (r.event.recurrence ? "↻ " : "") + r.event.name);
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
    const f = factsOf(r);
    if (q && !termsMatch(q, f.hay)) return false;
    if (!itemFilters.test(f)) return false;
    return inRange(r) && inPartOfDay(r);
  }
  /** Mornings before noon, afternoons noon–5 PM, evenings from 5 PM. Events with no posted time always count. */
  function inPartOfDay(r: Row): boolean {
    if (partOfDay === "any" || !hasTime(r.event.date)) return true;
    const hr = parseEventDate(r.event.date).getHours();
    return partOfDay === "morning" ? hr < 12 : partOfDay === "afternoon" ? hr >= 12 && hr < 17 : hr >= 17;
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
    showItemCard(wrap, "event", r.event, r.owner, () => cb.onCoalitionClick(r.owner.node));
  }

  function eventCard(r: Row): HTMLElement {
      const card = h(
        "div",
        { class: `list-card${sectorAttrs(r.owner).cls}`, style: sectorAttrs(r.owner).style },
        h(
          "div",
          { class: "head" },
          ownerBadge(r.owner),
          h("div", { class: "coalition-name" }, r.owner.name), sectorPill(r.owner),
        ),
        h("div", { class: "name" }, r.event.name),
        h(
          "div",
          { class: "meta-row" },
          h("span", { class: "pill deadline" }, fmtEventTime(r.event.date, r.event.end, r.event.recurrence)),
          h("span", { class: "pill kind" }, r.event.location),
          !r.isUpcoming && h("span", { class: "pill" }, "past"),
        ),
        itemButtons("event", r.event),
        staleNotice("event", r.owner.node, r.event.needs_info, r.event.verified, r.event),
      );
      card.querySelectorAll("a").forEach((a) => a.addEventListener("click", (ev) => ev.stopPropagation()));
      card.addEventListener("click", () => showDetail(r));
      return card;
  }

  render();
  return { el: wrap, refresh: render };
}
