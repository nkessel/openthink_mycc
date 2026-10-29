import { accessibilityButton } from "./display";
import { h } from "./dom";
import { currentMap, MAPS, switchMap, type MapId } from "./maps";

export type TopTab = "map" | "geo" | "orgs" | "events" | "projects" | "actions" | "topics";

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
  const brand = h("a", { class: "brand", href: "./", title: `${currentMap.fullTitle} — click: back to the map · right-click: switch map` }, h("span", { class: "brand-long" }, currentMap.title), h("span", { class: "brand-short" }, currentMap.short || currentMap.title));
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
    mapMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 220))}px`;
    mapMenu.style.top = `${r.bottom + 6}px`;
    mapMenu.style.display = "block";
    (mapMenu.querySelector(".map-opt") as HTMLElement | null)?.focus();
  }
  document.addEventListener("click", (e) => { if (!mapMenu.contains(e.target as Node) && !longPressed) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);

  // Order (Oct 29): the three views, then the lists under "Directories" (a heading in the phone menu, a divider on
  // wide screens).
  // Each page has a one-line hint (Oct 29: "make the menu more self-explanatory"): a second line in the phone menu,
  // a tooltip on wide screens.
  const tabs: { id: TopTab; label: string; hint: string; disabled?: boolean; group?: "dir" }[] = [
    { id: "map", label: "Map", hint: "Groups and coalitions, and who works with whom" },
    { id: "geo", label: "Geographic", hint: "Where groups and events are, on a map" },
    { id: "topics", label: "Topics", hint: "What groups are working on" },
    { id: "orgs", label: "Organizations", hint: "Every group, with its links and contacts", group: "dir" },
    { id: "events", label: "Events", hint: "Upcoming events you can go to", group: "dir" },
    { id: "projects", label: "Projects", hint: "Ongoing work you can join", group: "dir" },
    { id: "actions", label: "Actions", hint: "Things to do now, and volunteer roles", group: "dir" },
  ];
  const buttons = new Map<TopTab, HTMLElement>();
  // On a phone the tabs don't fit: they fold into a menu opened from a button showing the current tab.
  const nav = h("nav", { class: "tabs", id: "top-tabs", "aria-label": "Pages" });
  const menuLabel = h("span", { class: "tab-menu-label" }, tabs.find((t) => t.id === active)?.label ?? "Menu");
  const menuBtn = h("button", { class: "tab-menu-btn", type: "button", title: "Pages: map, topics and lists", "aria-label": "Menu of pages", "aria-haspopup": "true", "aria-expanded": "false", "aria-controls": "top-tabs" },
    menuLabel, h("span", { class: "tab-menu-icon", "aria-hidden": "true" }, "\u2630"));
  const setOpen = (open: boolean) => {
    bar.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!bar.classList.contains("menu-open")); });
  document.addEventListener("click", (e) => { if (!nav.contains(e.target as Node)) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  let dirHead = false;
  for (const t of tabs) {
    if (t.group === "dir" && !dirHead) {
      dirHead = true;
      nav.appendChild(h("div", { class: "tab-group-head", role: "presentation" }, "Directories: lists you can search"));
    }
    const btn = h(
      "button",
      {
        class: `tab ${t.id === active ? "active" : ""} ${t.disabled ? "disabled" : ""}`,
        "data-tab": t.id,
        title: t.hint,
      },
      h("span", { class: "tab-label" }, t.label),
      h("span", { class: "tab-hint" }, t.hint),
    );
    if (!t.disabled) {
      btn.addEventListener("click", () => {
        for (const [, el] of buttons) el.classList.remove("active");
        btn.classList.add("active");
        menuLabel.textContent = t.label;
        setOpen(false);
        cb.onTabChange(t.id);
      });
    }
    buttons.set(t.id, btn);
    nav.appendChild(btn);
  }
  // (No "Switch map…" item: the other maps stay a quiet extra, reached by long-pressing or right-clicking the title.)
  bar.appendChild(nav);
  bar.appendChild(accessibilityButton());
  bar.appendChild(menuBtn);

  return {
    setActive(tab) {
      for (const [id, el] of buttons) {
        el.classList.toggle("active", id === tab);
      }
      menuLabel.textContent = tabs.find((t) => t.id === tab)?.label ?? menuLabel.textContent;
    },
  };
}
