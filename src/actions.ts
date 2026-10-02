// Actions & volunteer opportunities: things a person can do (sign, call, show up) or roles groups need filled.
import type { Action, DataFile, GraphNode } from "./types";
import { allActions, ownerBadge, type Owner } from "./owners";
import { itemButtons } from "./links";
import { h, clear } from "./dom";
import { staleNotice } from "./notice";

export interface ActionsView {
  el: HTMLElement;
  refresh(): void;
}

export interface ActionsCallbacks {
  onCoalitionClick(node: GraphNode): void;
}

interface Row {
  action: Action;
  owner: Owner;
}

export function createActionsView(data: DataFile, cb: ActionsCallbacks): ActionsView {
  const wrap = h("div", { class: "list-view" });
  const rows: Row[] = allActions(data);

  const skillSet = new Set<string>();
  for (const r of rows) for (const s of r.action.skills_needed || []) skillSet.add(s);
  const allSkills = Array.from(skillSet).sort();

  type KindFilter = "all" | "task" | "role";
  let q = "";
  let kindFilter: KindFilter = "all";
  const selectedSkills = new Set<string>();

  const toolbar = h("div", { class: "list-toolbar" });
  toolbar.appendChild(h("h2", {}, "Actions & Volunteer Opportunities"));
  const count = h("span", { class: "count" }, "");
  toolbar.appendChild(count);

  const search = h("input", {
    class: "search",
    type: "search",
    placeholder: "Search actions, groups, or orgs…",
  }) as HTMLInputElement;
  search.addEventListener("input", () => {
    q = search.value.trim().toLowerCase();
    render();
  });
  toolbar.appendChild(search);

  const kindFilters = h("div", { class: "filters" });
  const kindDefs: { id: KindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "task", label: "Take action" },
    { id: "role", label: "Volunteer roles" },
  ];
  const kindChips = new Map<string, HTMLElement>();
  for (const f of kindDefs) {
    const chip = h("button", { class: `chip ${kindFilter === f.id ? "active" : ""}` }, f.label);
    chip.addEventListener("click", () => {
      kindFilter = f.id;
      for (const [id, el] of kindChips) el.classList.toggle("active", id === kindFilter);
      render();
    });
    kindChips.set(f.id, chip);
    kindFilters.appendChild(chip);
  }
  toolbar.appendChild(kindFilters);
  wrap.appendChild(toolbar);

  if (allSkills.length) {
    const skillBar = h("div", {
      class: "list-toolbar",
      style: "padding-top:8px;padding-bottom:8px;border-bottom:1px solid var(--border)",
    });
    skillBar.appendChild(
      h("span", { class: "count", style: "color:var(--text-faint);font-size:11px;text-transform:uppercase;letter-spacing:0.06em" }, "Skills needed"),
    );
    const skillChips = h("div", { class: "filters" });
    for (const s of allSkills) {
      const chip = h("button", { class: "chip" }, s);
      chip.addEventListener("click", () => {
        if (selectedSkills.has(s)) { selectedSkills.delete(s); chip.classList.remove("active"); }
        else { selectedSkills.add(s); chip.classList.add("active"); }
        render();
      });
      skillChips.appendChild(chip);
    }
    skillBar.appendChild(skillChips);
    wrap.appendChild(skillBar);
  }

  const body = h("div", { class: "list-body" });
  wrap.appendChild(body);

  function matches(r: Row): boolean {
    const a = r.action;
    if (kindFilter !== "all" && a.kind !== kindFilter) return false;
    if (selectedSkills.size > 0 && !(a.skills_needed || []).some((s) => selectedSkills.has(s))) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.description || "").toLowerCase().includes(q) ||
      r.owner.name.toLowerCase().includes(q) ||
      r.owner.abbrev.toLowerCase().includes(q)
    );
  }

  function render() {
    clear(body);
    const filtered = rows.filter(matches);
    count.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
    if (!filtered.length) {
      body.appendChild(h("div", { class: "list-empty" }, "Nothing matches."));
      return;
    }
    for (const r of filtered) {
      const a = r.action;
      const meta = h("div", { class: "meta-row" });
      meta.appendChild(h("span", { class: "pill kind" }, a.kind === "role" ? "volunteer role" : "action"));
      if (a.urgency) meta.appendChild(h("span", { class: `pill ${a.urgency}` }, `${a.urgency} urgency`));
      if (a.deadline) meta.appendChild(h("span", { class: "pill deadline" }, `by ${a.deadline}`));
      for (const s of a.skills_needed || []) meta.appendChild(h("span", { class: "pill skill" }, s));
      const card = h(
        "div",
        { class: "list-card" },
        h("div", { class: "head" }, ownerBadge(r.owner), h("div", { class: "coalition-name" }, r.owner.name)),
        h("div", { class: "name" }, a.name),
        a.description ? h("div", { class: "desc" }, a.description) : null,
        meta,
        itemButtons("action", a),
        staleNotice("action", r.owner.node, a.needs_info, a.verified, a),
      );
      card.querySelectorAll("a").forEach((l) => l.addEventListener("click", (ev) => ev.stopPropagation()));
      card.addEventListener("click", () => cb.onCoalitionClick(r.owner.node));
      body.appendChild(card);
    }
  }

  render();
  return { el: wrap, refresh: render };
}
