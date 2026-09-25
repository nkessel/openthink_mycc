import type { DataFile } from "./types";
import { h, clear } from "./dom";

export interface Sidebar {
  setVisibleCoalitions(ids: Set<string>): void;
  getVisibleCoalitions(): Set<string>;
  /** Extra filters, right under the coalitions list. */
  filtersContainer(): HTMLElement;
  /** A mount point below the coalitions list, above the legend. */
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
  aside.prepend(hideBtn);
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
  const legendBlock = h("div", { class: "legend-block" });
  aside.appendChild(coalitionsBlock);
  aside.appendChild(filtersBlock);
  aside.appendChild(controlsBlock);
  aside.appendChild(legendBlock);

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

  function renderLegend() {
    clear(legendBlock);
    const legend = h("div", { class: "legend" });
    legend.appendChild(h("h3", {}, "Legend"));
    legend.appendChild(
      h(
        "div",
        { class: "row" },
        h("div", {
          class: "swatch",
          style: "width:22px;height:22px",
        }),
        h("div", {}, "Coalition (size ∝ members)"),
      ),
    );
    legend.appendChild(
      h(
        "div",
        { class: "row" },
        h("div", {
          class: "swatch",
          style: "width:10px;height:10px",
        }),
        h("div", {}, "Member organization"),
      ),
    );
    legend.appendChild(
      h(
        "div",
        { class: "row" },
        h("div", {
          style:
            "width:24px;height:1px;background:rgba(255,255,255,0.3);align-self:center",
        }),
        h("div", {}, "Membership edge"),
      ),
    );
    legendBlock.appendChild(legend);
  }

  renderCoalitions();
  renderLegend();

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
