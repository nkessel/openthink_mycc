import { h } from "./dom";
import { currentMap, MAPS, switchMap, type MapId } from "./maps";

export type TopTab = "map" | "geo" | "orgs" | "events" | "projects" | "actions";

export interface TopbarCallbacks {
  onTabChange(tab: TopTab): void;
  /** The brand/logo was clicked: go back to the default map. */
  onHome?(): void;
}

export function createTopbar(
  parent: HTMLElement,
  cb: TopbarCallbacks,
  active: TopTab = "map",
): { setActive(tab: TopTab): void } {
  const bar = h("header", { class: "topbar" });
  parent.appendChild(bar);

  // Short name so it fits on one line, even on phones; the full name is the tooltip / page title.
  const brand = h("a", { class: "brand", href: "./", title: `${currentMap.fullTitle} — click: back to the map · right-click: switch map` }, currentMap.title);
  brand.addEventListener("click", (e) => {
    e.preventDefault();
    cb.onHome?.();
  });
  bar.appendChild(brand);

  // Right-click (or long-press on a phone) the title to switch between maps.
  const mapMenu = h("div", { class: "map-menu", role: "menu", "aria-label": "Switch map" });
  mapMenu.appendChild(h("div", { class: "map-menu-head" }, "Switch map"));
  // States in the order they're listed in maps.ts, with the USA view last.
  const ids = (Object.keys(MAPS) as MapId[]).sort((a, b) => Number(a === "us") - Number(b === "us"));
  for (const id of ids) {
    const m = MAPS[id];
    const opt = h("button", { class: `map-opt ${id === currentMap.id ? "active" : ""}`, type: "button", role: "menuitemradio", "aria-checked": String(id === currentMap.id) },
      h("span", { class: "map-opt-check" }, id === currentMap.id ? "●" : ""), `${m.name} map`);
    opt.addEventListener("click", () => {
      closeMenu();
      if (id !== currentMap.id) switchMap(id);
    });
    mapMenu.appendChild(opt);
  }
  mapMenu.style.display = "none";
  document.body.appendChild(mapMenu);
  function closeMenu() { mapMenu.style.display = "none"; }
  // iPhones don't send contextmenu for a long-press on a link, so time it ourselves.
  let pressTimer = 0;
  let longPressed = false;
  brand.addEventListener("touchstart", () => {
    longPressed = false;
    pressTimer = window.setTimeout(() => { longPressed = true; openMenu(); }, 550);
  }, { passive: true });
  const cancelPress = () => clearTimeout(pressTimer);
  brand.addEventListener("touchend", cancelPress);
  brand.addEventListener("touchmove", cancelPress, { passive: true });
  brand.addEventListener("click", (e) => { if (longPressed) { e.preventDefault(); e.stopImmediatePropagation(); longPressed = false; } }, true);
  brand.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMenu();
  });
  function openMenu() {
    const r = brand.getBoundingClientRect();
    mapMenu.style.left = `${Math.max(8, r.left)}px`;
    mapMenu.style.top = `${r.bottom + 6}px`;
    mapMenu.style.display = "block";
    (mapMenu.querySelector(".map-opt") as HTMLElement | null)?.focus();
  }
  document.addEventListener("click", (e) => { if (!mapMenu.contains(e.target as Node) && !longPressed) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);

  const tabs: { id: TopTab; label: string; disabled?: boolean }[] = [
    { id: "map", label: "Map" },
    { id: "geo", label: "Geographic" },
    { id: "orgs", label: "Organizations" },
    { id: "events", label: "Events" },
    { id: "projects", label: "Projects" },
    { id: "actions", label: "Actions" },
  ];
  const buttons = new Map<TopTab, HTMLElement>();

  for (const t of tabs) {
    const btn = h(
      "button",
      {
        class: `tab ${t.id === active ? "active" : ""} ${t.disabled ? "disabled" : ""}`,
      },
      t.label,
    );
    if (!t.disabled) {
      btn.addEventListener("click", () => {
        for (const [, el] of buttons) el.classList.remove("active");
        btn.classList.add("active");
        cb.onTabChange(t.id);
      });
    }
    buttons.set(t.id, btn);
    bar.appendChild(btn);
  }

  return {
    setActive(tab) {
      for (const [id, el] of buttons) {
        el.classList.toggle("active", id === tab);
      }
    },
  };
}
