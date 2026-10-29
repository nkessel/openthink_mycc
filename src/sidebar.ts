import type { DataFile } from "./types";
import { h, clear } from "./dom";

export interface Sidebar {
  setVisibleCoalitions(ids: Set<string>): void;
  getVisibleCoalitions(): Set<string>;
  /** Extra filters, right under the coalitions list. */
  filtersContainer(): HTMLElement;
  linksContainer(): HTMLElement;
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

  // Social-justice layers (src/sectors.ts) bring their own coalition bubbles; those start hidden so the map stays
  // about the climate coalitions. Their groups still show (graph.ts), and the coalition can be ticked on here.
  let visible = new Set(data.coalitions.filter((c) => !(c as { sector?: string }).sector).map((c) => c.id));

  // Sub-containers — built once. Only the coalitions list re-renders.
  const coalitionsBlock = h("div", { class: "coalitions-block" });
  /** Right under the coalitions: the "Groups that work together" switch (main.ts puts it here). */
  const linksBlock = h("div", { class: "links-block" });
  const filtersBlock = h("div", { class: "filters-block" });
  const controlsBlock = h("div", { class: "controls-block" });
  // Coalitions fold open and closed (Oct 29), remembered in this browser. Inside, the All / None buttons and the
  // "Groups that work together" switch come first, then the list.
  const COAL_KEY = "openthink.coalitionsOpen";
  let coalOpen = true;
  try { coalOpen = localStorage.getItem(COAL_KEY) !== "0"; } catch { /* ignore */ }
  const coalHead = h("button", { class: "section-head coalitions-head", type: "button", "aria-expanded": String(coalOpen) },
    h("span", { class: "caret" }, "▾"), h("span", { class: "section-title" }, "Coalitions"));
  const coalSection = h("section", { class: `panel-section coalitions-section ${coalOpen ? "open" : ""}` });
  const coalBody = h("div", { class: "section-body" });
  coalHead.addEventListener("click", () => {
    coalOpen = !coalSection.classList.contains("open");
    coalSection.classList.toggle("open", coalOpen);
    coalHead.setAttribute("aria-expanded", String(coalOpen));
    try { localStorage.setItem(COAL_KEY, coalOpen ? "1" : "0"); } catch { /* ignore */ }
  });
  const coalTools = h("div", { class: "coalitions-tools" });
  coalBody.append(coalTools, linksBlock, coalitionsBlock);
  coalSection.append(coalHead, coalBody);
  aside.appendChild(coalSection);
  aside.appendChild(filtersBlock);
  aside.appendChild(controlsBlock);

  // The land acknowledgement and dedication from the loading screen, kept reachable once the map is up.
  const landLink = h("button", { class: "land-link", type: "button" }, "Land acknowledgement & dedication");
  landLink.addEventListener("click", openLandDialog);
  aside.appendChild(landLink);

  function renderCoalitions() {
    clear(coalitionsBlock);
    clear(coalTools);

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
    actions.appendChild(h("span", { class: "coalitions-tools-label" }, "Show:"));
    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    coalTools.appendChild(actions);
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
    linksContainer() {
      return linksBlock;
    },
    controlsContainer() {
      return controlsBlock;
    },
    element() {
      return aside;
    },
  };
}

/** The capitol icon used for the legislature in the money & opposition layer (same shape as in graph.ts). */
function capitolMark(): HTMLElement {
  const span = h("span", { class: "capitol-mark" });
  span.innerHTML = '<svg viewBox="0 0 100 100" width="14" height="14"><path d="M48 4h4v12h-4z M27 40a23 23 0 0 1 46 0z M22 40h56v7H22z M10 56L50 47L90 56z M16 58h9v24h-9z M31 58h9v24h-9z M46 58h8v24h-8z M60 58h9v24h-9z M75 58h9v24h-9z M8 84h84v6H8z M4 92h92v5H4z"/></svg>';
  return span;
}

/** The key to the network map, shown on the map itself (bottom-left); click its title to fold it. */
export function createMapLegend(
  parent: HTMLElement,
  sectors: { label: string; color: string }[] = [],
  orgLinks?: { box: HTMLInputElement; count: number },
  money = false,
): HTMLElement {
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
      // "Coalition" reads as jargon to some (Oct 23 meeting), and testers asked how the big bubbles relate to the small ones.
      h("div", { class: "map-legend-note" }, "A coalition is a network of groups that work toward shared goals. Each big bubble is a coalition; the small bubbles linked to it are its member groups."),
      row(h("span", { class: "swatch", style: "width:9px;height:9px" }), "Organization"),
      row(h("span", { class: "line" }), "Member of a coalition"),
      ...(orgLinks && orgLinks.count ? [orgLinkRow(orgLinks.box, orgLinks.count)] : []),
      h("div", { class: "map-legend-sub" }, "Dots around each group"),
      row(h("span", { class: "kdot k-event" }), "Event"),
      row(h("span", { class: "kdot k-project" }), "Project"),
      row(h("span", { class: "kdot k-action" }), "Action"),
      row(h("span", { class: "kdot k-volunteer" }), "Volunteer role"),
      ...(sectors.length ? [h("div", { class: "map-legend-sub" }, "Social justice (switched on in Map settings)")] : []),
      ...sectors.map((s) => row(h("span", { class: "swatch sector-swatch", style: `--sector:${s.color}` }), s.label)),
      ...(money ? [
        h("div", { class: "map-legend-sub" }, "Money & opposition (Map settings)"),
        row(h("span", { class: "swatch opp-halo", style: "width:9px;height:9px" }), "Opposed climate bills on the record"),
        row(capitolMark(), "Oregon Legislature"),
        row(h("span", { class: "line money-line side-good" }), "Lobbying by climate groups (thicker = more)"),
        row(h("span", { class: "line money-line side-bad" }), "Lobbying by opposing groups"),
        row(h("span", { class: "line money-line k-political" }), "Political spending (opposing group)"),
      ] : []),
    ),
  );
  parent.appendChild(legend);
  return legend;
}

/** "Works with (n)" in the legend, with a Hide/Show button that drives the same switch as Map settings → Advanced. */
function orgLinkRow(box: HTMLInputElement, count: number): HTMLElement {
  const btn = h("button", { type: "button", class: "legend-hide" }) as HTMLButtonElement;
  const sync = () => {
    btn.textContent = box.checked ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", String(!box.checked));
    row.classList.toggle("off", !box.checked);
  };
  btn.addEventListener("click", () => {
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change"));
  });
  box.addEventListener("change", sync);
  const row = h("div", { class: "row" }, h("span", { class: "line org" }), h("span", {}, `Groups that work together (${count})`), btn);
  sync();
  return row;
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
