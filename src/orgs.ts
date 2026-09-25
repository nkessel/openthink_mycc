// Organizations: a searchable, filterable list of every org, plus a "Suggested connections"
// mode that lists pairs of similar orgs that aren't connected yet (the "holes").
import type { DataFile, GraphNode, Organization } from "./types";
import { h, clear } from "./dom";
import { initials, typeLabel } from "./util";
import { computeSuggestions } from "./suggestions";

export interface OrgsView {
  el: HTMLElement;
  refresh(): void;
}

export interface OrgsCallbacks {
  onOrgClick(node: GraphNode): void;
}

type Mode = "list" | "suggested";

export function createOrgsView(data: DataFile, cb: OrgsCallbacks): OrgsView {
  const wrap = h("div", { class: "list-view" });
  const byId = new Map(data.organizations.map((o) => [o.id, o]));
  const coalitionName = new Map(data.coalitions.map((c) => [c.id, c.abbrev || c.name]));
  const linkCount = new Map<string, number>();
  for (const l of data.org_links || []) {
    linkCount.set(l.source, (linkCount.get(l.source) || 0) + 1);
    linkCount.set(l.target, (linkCount.get(l.target) || 0) + 1);
  }

  let mode: Mode = "list";
  let q = "";
  let coalition = "";
  let type = "";
  let youthOnly = false;

  // ---- Toolbar
  const toolbar = h("div", { class: "list-toolbar" });
  toolbar.appendChild(h("h2", {}, "Organizations"));
  const count = h("span", { class: "count" }, "");
  toolbar.appendChild(count);
  const search = h("input", { class: "search", type: "search", placeholder: "Search organizations, towns, or topics…" }) as HTMLInputElement;
  search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); render(); });
  toolbar.appendChild(search);

  const modes = h("div", { class: "filters" });
  const modeChips = new Map<Mode, HTMLElement>();
  for (const m of [{ id: "list" as Mode, label: "All organizations" }, { id: "suggested" as Mode, label: "Suggested connections" }]) {
    const chip = h("button", { class: `chip ${mode === m.id ? "active" : ""}` }, m.label);
    chip.addEventListener("click", () => {
      mode = m.id;
      for (const [id, el] of modeChips) el.classList.toggle("active", id === mode);
      render();
    });
    modeChips.set(m.id, chip);
    modes.appendChild(chip);
  }
  toolbar.appendChild(modes);
  wrap.appendChild(toolbar);

  // ---- Filter row
  const filterBar = h("div", { class: "list-toolbar", style: "padding-top:8px;padding-bottom:8px;border-bottom:1px solid var(--border)" });
  const coalitionSel = h("select", { class: "select", "aria-label": "Coalition" }) as HTMLSelectElement;
  coalitionSel.appendChild(h("option", { value: "" }, "All coalitions"));
  for (const c of data.coalitions) coalitionSel.appendChild(h("option", { value: c.id }, c.name));
  coalitionSel.appendChild(h("option", { value: "__none" }, "Not in a coalition"));
  coalitionSel.addEventListener("change", () => { coalition = coalitionSel.value; render(); });
  const typeSel = h("select", { class: "select", "aria-label": "Type" }) as HTMLSelectElement;
  typeSel.appendChild(h("option", { value: "" }, "All types"));
  for (const t of [...new Set(data.organizations.map((o) => o.type))].sort()) {
    typeSel.appendChild(h("option", { value: t }, typeLabel(t)));
  }
  typeSel.addEventListener("change", () => { type = typeSel.value; render(); });
  const youthBox = h("input", { type: "checkbox" }) as HTMLInputElement;
  youthBox.addEventListener("change", () => { youthOnly = youthBox.checked; render(); });
  filterBar.appendChild(coalitionSel);
  filterBar.appendChild(typeSel);
  filterBar.appendChild(h("label", { class: "check" }, youthBox, " Youth-serving only"));
  wrap.appendChild(filterBar);

  const body = h("div", { class: "list-body" });
  wrap.appendChild(body);

  function orgMatches(o: Organization): boolean {
    if (coalition === "__none" && o.coalition_ids.length) return false;
    if (coalition && coalition !== "__none" && !o.coalition_ids.includes(coalition)) return false;
    if (type && o.type !== type) return false;
    if (youthOnly && !o.profile?.youth_serving) return false;
    if (!q) return true;
    const hay = `${o.name} ${o.abbrev || ""} ${o.geographic_focus} ${o.description} ${(o.topic_tags || []).join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  function badge(o: Organization): HTMLElement {
    return o.logo
      ? h("div", { class: "coalition-badge logo" }, h("img", { src: o.logo, alt: "" }))
      : h("div", { class: "coalition-badge", style: "background:#3a3a4a;color:#e5e7eb" }, o.abbrev ? o.abbrev.slice(0, 4) : initials(o.name));
  }

  function renderList() {
    const rows = data.organizations.filter(orgMatches).sort((a, b) => a.name.localeCompare(b.name));
    count.textContent = `${rows.length} organization${rows.length === 1 ? "" : "s"}`;
    if (!rows.length) return body.appendChild(h("div", { class: "list-empty" }, "No organizations match."));
    for (const o of rows) {
      const meta = h("div", { class: "meta-row" });
      for (const cid of o.coalition_ids) meta.appendChild(h("span", { class: "pill kind" }, coalitionName.get(cid) || cid));
      if (linkCount.get(o.id)) meta.appendChild(h("span", { class: "pill" }, `works with ${linkCount.get(o.id)}`));
      if (o.profile?.youth_serving) meta.appendChild(h("span", { class: "pill" }, "youth-serving"));
      if (o.remote) meta.appendChild(h("span", { class: "pill" }, "remote"));
      const card = h(
        "div",
        { class: "list-card" },
        h("div", { class: "head" }, badge(o), h("div", { class: "coalition-name" }, [typeLabel(o.type), o.geographic_focus].filter(Boolean).join(" · "))),
        h("div", { class: "name" }, o.name),
        o.description ? h("div", { class: "desc" }, o.description) : null,
        meta,
      );
      card.addEventListener("click", () => cb.onOrgClick({ ...o, kind: "org" }));
      body.appendChild(card);
    }
  }

  function renderSuggested() {
    const pairs = computeSuggestions(data).filter((s) => {
      const a = byId.get(s.a)!, b = byId.get(s.b)!;
      return orgMatches(a) || orgMatches(b);
    });
    count.textContent = `${pairs.length} suggested pair${pairs.length === 1 ? "" : "s"}`;
    body.appendChild(
      h("div", { class: "list-note" },
        "Organizations doing similar work that haven't said they work together. Suggestions improve as groups add descriptions, topics, and who they work with."),
    );
    if (!pairs.length) return body.appendChild(h("div", { class: "list-empty" }, "No suggestions match."));
    for (const s of pairs.slice(0, 60)) {
      const a = byId.get(s.a)!, b = byId.get(s.b)!;
      const side = (o: Organization) => {
        const el = h("button", { class: "pair-org", type: "button" }, badge(o), h("span", {}, o.name));
        el.addEventListener("click", (e) => { e.stopPropagation(); cb.onOrgClick({ ...o, kind: "org" }); });
        return el;
      };
      body.appendChild(
        h(
          "div",
          { class: "list-card pair" },
          h("div", { class: "pair-row" }, side(a), h("span", { class: "pair-plus" }, "↔"), side(b)),
          h("div", { class: "desc" }, s.reasons.join(" · ") + (s.sharedCoalition ? " · Already share a coalition" : "")),
          h("div", { class: "meta-row" }, h("span", { class: "pill deadline" }, `${Math.round(s.score * 100)}% match`)),
        ),
      );
    }
  }

  function render() {
    clear(body);
    if (mode === "list") renderList();
    else renderSuggested();
  }

  render();
  return { el: wrap, refresh: render };
}
