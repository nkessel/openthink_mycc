import type { GraphNode } from "./types";
import { initials, relTime, typeLabel } from "./util";
import { h, clear } from "./dom";

export interface ActivityCounts { projects: number; events: number; actions: number }

export interface Tooltip {
  /** Lets the graph say how many projects / events / actions a node has. */
  setCounts(fn: (node: GraphNode) => ActivityCounts): void;
  show(node: GraphNode, x: number, y: number): void;
  hide(): void;
  move(x: number, y: number): void;
}

export function createTooltip(): Tooltip {
  const el = document.createElement("div");
  el.className = "tooltip";
  document.body.appendChild(el);

  let currentNode: GraphNode | null = null;
  let counts: ((node: GraphNode) => ActivityCounts) | null = null;

  function position(x: number, y: number) {
    const rect = el.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + rect.width > window.innerWidth - 8) {
      left = x - rect.width - 14;
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = y - rect.height - 14;
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function stat(val: string | number, lbl: string): HTMLElement {
    return h(
      "div",
      { class: "stat" },
      h("div", { class: "val" }, String(val)),
      h("div", { class: "lbl" }, lbl),
    );
  }

  function activityStats(node: GraphNode): HTMLElement[] {
    const c = counts ? counts(node) : { projects: 0, events: 0, actions: 0 };
    return [stat(c.projects, "Projects"), stat(c.events, "Events"), stat(c.actions, "Actions")];
  }

  function render(node: GraphNode): HTMLElement[] {
    if (node.kind === "coalition") {
      const ttl = node.abbrev || initials(node.name);
      return [
        h(
          "div",
          { class: "header" },
          h(
            "div",
            { class: "swatch", style: `background:${node.color}` },
            ttl,
          ),
          h(
            "div",
            {},
            h("div", { class: "title" }, node.name),
            h(
              "div",
              { class: "subtitle" },
              `${node.geographic_scope} coalition`,
            ),
          ),
        ),
        h(
          "div",
          { class: "stats" },
          stat(node.member_count, "Member groups"),
          ...activityStats(node),
        ),
        h(
          "div",
          { class: "footer" },
          `Last updated ${relTime(node.last_activity)}`,
        ),
      ];
    } else {
      const ttl = initials(node.name);
      return [
        h(
          "div",
          { class: "header" },
          h(
            "div",
            {
              class: "swatch",
              style: "background:#3a3a4a;color:#e5e7eb",
            },
            ttl,
          ),
          h(
            "div",
            {},
            h("div", { class: "title" }, node.name),
            h(
              "div",
              { class: "subtitle" },
              [node.abbrev, typeLabel(node.type), node.geographic_focus].filter(Boolean).join(" · "),
            ),
          ),
        ),
        h(
          "div",
          { class: "stats" },
          stat(node.coalition_ids.length, "Coalitions"),
          ...activityStats(node),
          stat(relTime(node.last_activity), "Last updated"),
        ),
      ];
    }
  }

  return {
    setCounts(fn) {
      counts = fn;
    },
    show(node, x, y) {
      if (currentNode !== node) {
        currentNode = node;
        clear(el);
        for (const child of render(node)) el.appendChild(child);
      }
      el.classList.add("visible");
      position(x, y);
    },
    hide() {
      currentNode = null;
      el.classList.remove("visible");
    },
    move(x, y) {
      if (!currentNode) return;
      position(x, y);
    },
  };
}
