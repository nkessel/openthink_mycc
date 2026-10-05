import type { DataFile } from "./types";
import { h, clear } from "./dom";

export interface Sidebar {
  setVisibleCoalitions(ids: Set<string>): void;
  getVisibleCoalitions(): Set<string>;
  /** Extra filters, right under the coalitions list. */
  filtersContainer(): HTMLElement;
  /** A mount point below the coalitions list. */
  controlsContainer(): HTMLElement;
  element(): HTMLElement;
}

const MOBILE = "(max-width: 720px)";
const COLLAPSE_KEY = "mccm.sidebarCollapsed";

/**
 * Retractable sidebar. Desktop: the panel slides away and the map takes the full width
 * (remembered per browser). Phones: it starts hidden and opens as an overlay.
 */
export function setupSidebarToggle(view: HTMLElement, aside: HTMLElement, graphArea: HTMLElement): void {
  const mobile = () => window.matchMedia(MOBILE).matches;
  let saved: string | null = null;
  try { saved = localStorage.getItem(COLLAPSE_KEY); } catch { /* storage unavailable */ }

  const hideBtn = h("button", { class: "sidebar-hide", type: "button", "aria-label": "Hide panel", title: "Hide panel" }, "‹ Hide");
  const showBtn = h("button", { class: "sidebar-show", type: "button", "aria-label": "Show filters and settings", title: "Show filters and settings" }, "☰ Filters");
  // A header that stays at the top while the panel scrolls, with the hide button always next to it.
  const head = h("div", { class: "sidebar-head" }, h("span", { class: "sidebar-title" }, "Map settings"), hideBtn);
  aside.prepend(head);
  graphArea.appendChild(showBtn);

  const set = (collapsed: boolean, remember: boolean) => {
    view.classList.toggle("sidebar-collapsed", collapsed);
    showBtn.setAttribute("aria-expanded", String(!collapsed));
    if (remember && !mobile()) {
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
    }
    // The graph re-centers on window resize; its width changed on desktop.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  hideBtn.addEventListener("click", () => set(true, true));
  showBtn.addEventListener("click", () => set(false, true));
  // On phones, tapping the map closes the overlay.
  graphArea.addEventListener("pointerdown", (e) => {
    if (mobile() && !view.classList.contains("sidebar-collapsed") && e.target !== showBtn) set(true, false);
  });
  set(mobile() ? true : saved === "1", false);
}

export interface SidebarCallbacks {
  onChange(visible: Set<string>): void;
}

export function createSidebar(
  parent: HTMLElement,
  data: DataFile,
  cb: SidebarCallbacks,
): Sidebar {
  const aside = h("aside", { class: "sidebar", id: "map-sidebar" });
  parent.appendChild(aside);

  let visible = new Set(data.coalitions.map((c) => c.id));

  // Sub-containers — built once. Only the coalitions list re-renders.
  const coalitionsBlock = h("div", { class: "coalitions-block" });
  const filtersBlock = h("div", { class: "filters-block" });
  const controlsBlock = h("div", { class: "controls-block" });
  aside.appendChild(coalitionsBlock);
  aside.appendChild(filtersBlock);
  aside.appendChild(controlsBlock);

  // The land acknowledgement and dedication from the loading screen, kept reachable once the map is up.
  const landLink = h("button", { class: "land-link", type: "button" }, "Land acknowledgement & dedication");
  landLink.addEventListener("click", openLandDialog);
  aside.appendChild(landLink);

  function renderCoalitions() {
    clear(coalitionsBlock);
    coalitionsBlock.appendChild(h("h3", {}, "Coalitions"));

    for (const c of data.coalitions) {
      const cb_in = h("input", {
        type: "checkbox",
        id: `co-${c.id}`,
      }) as HTMLInputElement;
      cb_in.checked = visible.has(c.id);
      cb_in.addEventListener("change", () => {
        if (cb_in.checked) visible.add(c.id);
        else visible.delete(c.id);
        cb.onChange(new Set(visible));
      });
      const row = h(
        "label",
        { class: "coalition-row", for: `co-${c.id}` },
        cb_in,
        h("div", { class: "dot", style: `background:${c.color}` }),
        h("span", { class: "label" }, c.name),
        h("span", { class: "count" }, String(c.member_count)),
      );
      coalitionsBlock.appendChild(row);
    }

    const actions = h("div", { class: "actions" });
    const allBtn = h("button", {}, "All");
    const noneBtn = h("button", {}, "None");
    allBtn.addEventListener("click", () => {
      visible = new Set(data.coalitions.map((c) => c.id));
      renderCoalitions();
      cb.onChange(new Set(visible));
    });
    noneBtn.addEventListener("click", () => {
      visible = new Set();
      renderCoalitions();
      cb.onChange(new Set(visible));
    });
    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    coalitionsBlock.appendChild(actions);
  }

  renderCoalitions();

  return {
    setVisibleCoalitions(ids) {
      visible = new Set(ids);
      renderCoalitions();
    },
    getVisibleCoalitions() {
      return new Set(visible);
    },
    filtersContainer() {
      return filtersBlock;
    },
    controlsContainer() {
      return controlsBlock;
    },
    element() {
      return aside;
    },
  };
}

/** The key to the network map, shown on the map itself (bottom-left); click its title to fold it. */
export function createMapLegend(parent: HTMLElement, sectors: { label: string; color: string }[] = []): HTMLElement {
  // Open on wide screens; folded on phones, where it would cover a third of the map.
  const startOpen = !window.matchMedia("(max-width: 720px)").matches;
  const legend = h("div", { class: startOpen ? "map-legend open" : "map-legend" });
  const head = h("button", { class: "map-legend-head", type: "button", "aria-expanded": String(startOpen) }, "Legend");
  head.addEventListener("click", () => {
    const open = !legend.classList.contains("open");
    legend.classList.toggle("open", open);
    head.setAttribute("aria-expanded", String(open));
  });
  const row = (mark: HTMLElement, text: string) => h("div", { class: "row" }, mark, h("span", {}, text));
  legend.append(
    head,
    h("div", { class: "map-legend-body" },
      row(h("span", { class: "swatch", style: "width:18px;height:18px" }), "Coalition (size = member groups)"),
      row(h("span", { class: "swatch", style: "width:9px;height:9px" }), "Organization"),
      row(h("span", { class: "line" }), "Member of a coalition"),
      h("div", { class: "map-legend-sub" }, "Dots around each group"),
      row(h("span", { class: "kdot k-event" }), "Event"),
      row(h("span", { class: "kdot k-project" }), "Project"),
      row(h("span", { class: "kdot k-action" }), "Action"),
      row(h("span", { class: "kdot k-volunteer" }), "Volunteer role"),
      ...(sectors.length ? [h("div", { class: "map-legend-sub" }, "Social justice (switched on in Map settings)")] : []),
      ...sectors.map((s) => row(h("span", { class: "swatch sector-swatch", style: `--sector:${s.color}` }), s.label)),
    ),
  );
  parent.appendChild(legend);
  return legend;
}

/** A dialog with the same text as the loading screen's land acknowledgement and dedication (copied from index.html once at startup). */
let landHtml: string | null = null;
export function captureLandText(): void {
  landHtml = document.getElementById("land-dedication")?.innerHTML ?? null;
}
function openLandDialog(): void {
  if (!landHtml) return;
  const body = h("div", { class: "land-text" });
  body.innerHTML = landHtml; // our own markup from index.html
  const close = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
  const card = h("div", { class: "detail-card land-card", role: "dialog", "aria-label": "Land acknowledgement and dedication" }, close, body);
  const overlay = h("div", { class: "detail-overlay land-overlay" }, card);
  const done = () => overlay.remove();
  close.addEventListener("click", done);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) done(); });
  document.body.appendChild(overlay);
}
