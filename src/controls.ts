import type { GraphNode, OrgNode, CoalitionNode } from "./types";
import type { GraphSettings, GroupRule } from "./graph";
import { DEFAULT_GRAPH_SETTINGS } from "./graph";
import { showPast, setShowPast } from "./past";
import { h, clear } from "./dom";
import { typeLabel, typeList } from "./util";

export interface ControlsState {
  settings: GraphSettings;
  groups: GroupSpec[];
}

export interface GroupSpec {
  id: string;
  label: string;
  color: string;
  active: boolean;
  kind: "org_type" | "coalition_tag";
  matchValue: string;
}

export interface ControlsCallbacks {
  onSettingsChange(partial: Partial<GraphSettings>): void;
  onGroupsChange(rules: GroupRule[]): void;
  onAnimate(): void;
}

// v5: tighter default spacing — bumping the key lets everyone get the new defaults once.
const STORAGE_KEY = "openthink.controls.v6";

// Built-in group types (org types / coalition tags). All on by default.
// Hidden for now: few orgs have a type yet. Set SHOW_GROUP_TYPES = true to bring the section back.
const SHOW_GROUP_TYPES = false;
const DEFAULT_GROUPS: GroupSpec[] = [
  { id: "g_school_club", label: "School clubs", color: "#34d399", active: true, kind: "org_type", matchValue: "school_club" },
  { id: "g_youth_org", label: "Youth orgs", color: "#a3e635", active: true, kind: "org_type", matchValue: "youth_org" },
  { id: "g_faith_org", label: "Faith orgs", color: "#fb923c", active: true, kind: "org_type", matchValue: "faith_org" },
  { id: "g_501c3", label: "501(c)(3)s", color: "#60a5fa", active: true, kind: "org_type", matchValue: "501c3" },
  { id: "g_501c4", label: "501(c)(4)s", color: "#a78bfa", active: true, kind: "org_type", matchValue: "501c4" },
  { id: "g_union", label: "Unions", color: "#ef4444", active: true, kind: "org_type", matchValue: "union" },
  { id: "g_ej", label: "EJ-focused coalitions", color: "#f472b6", active: true, kind: "coalition_tag", matchValue: "environmental_justice" },
  { id: "g_youth_serving", label: "Youth-serving coalitions", color: "#22d3ee", active: true, kind: "coalition_tag", matchValue: "youth_serving" },
];

function loadState(): ControlsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ControlsState>;
      const settings = { ...DEFAULT_GRAPH_SETTINGS, ...(parsed.settings || {}) };
      // Merge groups: existing default list, override active/color from storage
      const stored = new Map((parsed.groups || []).map((g) => [g.id, g]));
      const groups = DEFAULT_GROUPS.map((g) => {
        const s = stored.get(g.id);
        return s ? { ...g, color: s.color, active: s.active } : g;
      });
      return { settings, groups };
    }
  } catch (_) { /* ignore */ }
  return {
    settings: { ...DEFAULT_GRAPH_SETTINGS },
    groups: DEFAULT_GROUPS.map((g) => ({ ...g })),
  };
}

function saveState(state: ControlsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) { /* ignore quota errors */ }
}

function specToRule(spec: GroupSpec): GroupRule {
  if (spec.kind === "org_type") {
    return {
      id: spec.id,
      label: spec.label,
      color: spec.color,
      matches: (n: GraphNode) =>
        n.kind === "org" && typeList((n as OrgNode).type).includes(spec.matchValue as string),
    };
  } else {
    return {
      id: spec.id,
      label: spec.label,
      color: spec.color,
      matches: (n: GraphNode) =>
        n.kind === "coalition" &&
        (n as CoalitionNode).focus_tags.includes(spec.matchValue),
    };
  }
}

export interface ControlsPanel {
  /** Returns the current settings + groups (after init applied). */
  initialState(): ControlsState;
  /** Returns the GroupRules corresponding to active groups, for graph.setGroups(). */
  activeRules(): GroupRule[];
  /** Where extra advanced options (e.g. the org-to-org links toggle) go. */
  advancedContainer(): HTMLElement;
}

export function createControls(
  parent: HTMLElement,
  cb: ControlsCallbacks,
): ControlsPanel {
  const state = loadState();
  // Apply persisted settings on mount
  cb.onSettingsChange(state.settings);
  cb.onGroupsChange(activeRulesFromSpecs(state.groups));

  function activeRulesFromSpecs(specs: GroupSpec[]): GroupRule[] {
    if (!SHOW_GROUP_TYPES) return []; // hidden section: don't colour the map by group type
    return specs.filter((g) => g.active).map(specToRule);
  }

  function notifyGroupsChanged() {
    cb.onGroupsChange(activeRulesFromSpecs(state.groups));
    saveState(state);
  }

  function makeSlider(
    label: string,
    initial: number,
    onChange: (v: number) => void,
    opts: { min?: number; max?: number; step?: number; hint?: string } = {},
  ): HTMLElement {
    const min = opts.min ?? 0;
    const max = opts.max ?? 1;
    const step = opts.step ?? 0.01;
    const wrap = h("div", { class: "control" });
    wrap.appendChild(h("label", { class: "ctrl-label" }, label));
    const input = h("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(initial),
      class: "slider",
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      onChange(parseFloat(input.value));
    });
    wrap.appendChild(input);
    if (opts.hint) wrap.appendChild(h("div", { class: "ctrl-hint slider-hint" }, opts.hint));
    return wrap;
  }

  function makeToggle(
    label: string,
    initial: boolean,
    onChange: (v: boolean) => void,
  ): HTMLElement {
    const wrap = h("div", { class: "control toggle-row" });
    wrap.appendChild(h("label", { class: "ctrl-label" }, label));
    const sw = h("button", {
      class: `switch ${initial ? "on" : ""}`,
      type: "button",
    });
    sw.appendChild(h("span", { class: "knob" }));
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      onChange(next);
    });
    wrap.appendChild(sw);
    return wrap;
  }

  function makeSection(title: string, initiallyOpen = true): {
    section: HTMLElement;
    body: HTMLElement;
  } {
    const section = h("section", { class: `panel-section ${initiallyOpen ? "open" : ""}` });
    const head = h("button", { class: "section-head", type: "button" });
    head.appendChild(h("span", { class: "caret" }, "▾"));
    head.appendChild(h("span", { class: "section-title" }, title));
    head.addEventListener("click", () => section.classList.toggle("open"));
    section.appendChild(head);
    const body = h("div", { class: "section-body" });
    section.appendChild(body);
    return { section, body };
  }

  // ---- Top of the bar: names, and hiding the events / actions / projects around each group ----
  const textRow = makeToggle("Show organization names", state.settings.showText, (v) => {
    state.settings.showText = v;
    cb.onSettingsChange({ showText: v });
    saveState(state);
  });
  textRow.classList.add("show-text-row");
  parent.appendChild(textRow);

  let itemsOn = true; // zoom in on a group when it's clicked
  try { itemsOn = localStorage.getItem("openthink.bubbles") !== "0"; } catch (_) { /* ignore */ }
  let previewsOn = true; // the dots around every group (shown by default)
  try { previewsOn = localStorage.getItem("openthink.previews") !== "0"; } catch (_) { /* ignore */ }

  const hideRow = makeToggle("Hide events, actions, and projects", !previewsOn, (v) => {
    window.dispatchEvent(new CustomEvent("openthink:setpreviews", { detail: { on: !v } }));
  });
  hideRow.classList.add("show-text-row");
  const hideSwitch = hideRow.querySelector<HTMLElement>(".switch")!;
  parent.appendChild(hideRow);
  // One switch for past items everywhere (they are always in each group's details pane, under "Past")
  const pastRow = makeToggle("Show past events, projects and actions", showPast(), (v) => setShowPast(v));
  pastRow.classList.add("show-text-row");
  pastRow.title = "Finished projects, events that have happened and actions whose deadline has passed. Each group's details always list them under Past.";
  parent.appendChild(pastRow);

  const { section: sizeSection, body: sizeBody } = makeSection("Events, projects & actions");

  // 2. Which kinds to preview (only while previews are on).
  const kindBox = h("div", { class: "kind-toggles" });
  kindBox.appendChild(h("div", { class: "ctrl-hint sub" }, "Which to show around each group:"));
  for (const [label, key] of [["Events", "showAllEvents"], ["Projects", "showAllProjects"], ["Actions & volunteer roles", "showAllActions"]] as const) {
    kindBox.appendChild(
      makeToggle(label, state.settings[key], (v) => {
        state.settings[key] = v;
        cb.onSettingsChange({ [key]: v });
        saveState(state);
      }),
    );
  }
  sizeBody.appendChild(kindBox);

  // 3. Clicking a group: zoom in and spread its events, projects & actions around it, or just open its details.
  const masterRow = makeToggle("Zoom in on a group when you click it", itemsOn, (v) => {
    window.dispatchEvent(new CustomEvent("openthink:setview", { detail: { bubbles: v } }));
  });
  const masterSwitch = masterRow.querySelector<HTMLElement>(".switch")!;
  sizeBody.appendChild(masterRow);
  sizeBody.appendChild(h("div", { class: "ctrl-hint" }, "Off: clicking a group only opens its details panel."));

  function syncItems() {
    masterSwitch.classList.toggle("on", itemsOn);
    hideSwitch.classList.toggle("on", !previewsOn);
    kindBox.classList.toggle("disabled", !previewsOn);
    kindBox.querySelectorAll("button").forEach((i) => ((i as HTMLButtonElement).disabled = !previewsOn));
  }
  syncItems();
  window.addEventListener("openthink:viewmode", (e) => {
    itemsOn = !!(e as CustomEvent).detail?.bubbles;
    syncItems();
  });
  window.addEventListener("openthink:previewsmode", (e) => {
    previewsOn = !!(e as CustomEvent).detail?.on;
    syncItems();
  });
  parent.appendChild(sizeSection);

  // ---- Bubble sizes: everything that changes how big the circles are, in one place ----
  const { section: bubbleSection, body: bubbleBody } = makeSection("Bubble sizes");
  bubbleBody.appendChild(
    makeSlider("Overall size", state.settings.nodeSize, (v) => {
      state.settings.nodeSize = v;
      cb.onSettingsChange({ nodeSize: v });
      saveState(state);
    }, { min: 0.4, max: 2.5, step: 0.05, hint: "Every group and organization bubble at once." }),
  );
  bubbleBody.appendChild(
    makeSlider("Coalitions: bigger with more member orgs", state.settings.weightConnections, (v) => {
      state.settings.weightConnections = v;
      cb.onSettingsChange({ weightConnections: v });
      saveState(state);
    }, { hint: "All the way down makes every coalition the same size." }),
  );
  const sliderBox = h("div", { class: "weight-sliders" });
  sliderBox.appendChild(h("div", { class: "ctrl-hint" }, "Increase bubble size for groups with more events, actions and projects:"));
  for (const [label, key] of [["Events", "weightEvents"], ["Projects", "weightProjects"], ["Actions & volunteer roles", "weightActions"]] as const) {
    sliderBox.appendChild(
      makeSlider(label, state.settings[key], (v) => {
        state.settings[key] = v;
        cb.onSettingsChange({ [key]: v });
        saveState(state);
      }, { min: 0, max: 3, step: 0.1 }),
    );
  }
  bubbleBody.appendChild(sliderBox);
  // Bubble sizes sits above "Events, projects & actions".
  parent.insertBefore(bubbleSection, sizeSection);

  // ---- Advanced display settings (closed by default; added to the panel last) ----
  const { section: advSection, body: advBody } = makeSection("Advanced display settings", false);
  advSection.classList.add("advanced");
  const advExtras = h("div", { class: "adv-extras" });
  advBody.appendChild(advExtras);
  const subHead = (t: string) => h("div", { class: "adv-subhead" }, t);

  // ---- Forces ----
  const forcesBody = h("div", { class: "adv-group" });
  advBody.appendChild(subHead("Forces"));
  advBody.appendChild(forcesBody);
  forcesBody.appendChild(
    makeSlider("Pull to the middle", state.settings.centerForce, (v) => {
      state.settings.centerForce = v;
      cb.onSettingsChange({ centerForce: v });
      saveState(state);
    }, { hint: "Draws everything toward the centre. Higher = a tighter, rounder map." }),
  );
  forcesBody.appendChild(
    makeSlider("Push organizations apart", state.settings.repelForce, (v) => {
      state.settings.repelForce = v;
      cb.onSettingsChange({ repelForce: v });
      saveState(state);
    }, { hint: "How hard organizations push each other away. Lower = organizations sit closer together." }),
  );
  forcesBody.appendChild(
    makeSlider("Push coalitions apart", state.settings.coalitionRepel, (v) => {
      state.settings.coalitionRepel = v;
      cb.onSettingsChange({ coalitionRepel: v });
      saveState(state);
    }, { hint: "How hard coalitions push away from each other and everything else. Higher = coalitions spread further apart." }),
  );
  forcesBody.appendChild(
    makeSlider("Pull to their coalition", state.settings.linkForce, (v) => {
      state.settings.linkForce = v;
      cb.onSettingsChange({ linkForce: v });
      saveState(state);
    }, { hint: "How strongly each organization is pulled toward the coalitions it belongs to. Higher = tighter clusters." }),
  );
  forcesBody.appendChild(
    makeSlider("Distance from their coalition", state.settings.linkDistance, (v) => {
      state.settings.linkDistance = v;
      cb.onSettingsChange({ linkDistance: v });
      saveState(state);
    }, { hint: "How far members like to sit from their coalition. Lower = members gather closer around it." }),
  );

  // ---- Group types ----
  const { section: groupsSection, body: groupsBody } = makeSection("Group Types");

  function renderGroups() {
    clear(groupsBody);
    for (const g of state.groups) {
      const row = h("div", { class: `group-row ${g.active ? "active" : ""}` });
      // Color picker (native input[type=color] for now)
      const colorInput = h("input", {
        type: "color",
        value: g.color,
        class: "color-input",
        title: "Pick color",
      }) as HTMLInputElement;
      colorInput.addEventListener("input", () => {
        g.color = colorInput.value;
        // Live update if active
        if (g.active) notifyGroupsChanged();
        else saveState(state);
      });
      const labelEl = h("div", { class: "group-label" }, g.label);
      const swatch = h("div", {
        class: "group-swatch",
        style: `background:${g.color}`,
      });
      // Toggle pill
      const toggle = h("button", {
        class: `switch sm ${g.active ? "on" : ""}`,
        type: "button",
        "aria-label": g.active ? "Disable group" : "Enable group",
      });
      toggle.appendChild(h("span", { class: "knob" }));
      toggle.addEventListener("click", () => {
        g.active = !g.active;
        row.classList.toggle("active", g.active);
        toggle.classList.toggle("on", g.active);
        notifyGroupsChanged();
      });
      // Clicking the swatch opens the color picker
      swatch.addEventListener("click", () => colorInput.click());
      row.appendChild(swatch);
      row.appendChild(labelEl);
      row.appendChild(toggle);
      row.appendChild(colorInput);
      groupsBody.appendChild(row);
    }
  }
  renderGroups();

  // ---- Display (inside Advanced) ----
  const displayBody = h("div", { class: "adv-group" });
  advBody.appendChild(subHead("Display"));
  advBody.appendChild(displayBody);
  displayBody.appendChild(
    makeSlider("Line thickness", state.settings.linkThickness, (v) => {
      state.settings.linkThickness = v;
      cb.onSettingsChange({ linkThickness: v });
      saveState(state);
    }, { min: 0.5, max: 5, step: 0.1, hint: "The lines between coalitions and their members." }),
  );

  const animateBtn = h(
    "button",
    { class: "animate-btn", type: "button", title: "Shake the map so everything settles again" },
    "Re-settle the map",
  );
  animateBtn.addEventListener("click", () => cb.onAnimate());
  displayBody.appendChild(animateBtn);

  const resetBtn = h(
    "button",
    { class: "reset-btn", type: "button" },
    "Reset to defaults",
  );
  resetBtn.addEventListener("click", () => {
    state.settings = { ...DEFAULT_GRAPH_SETTINGS };
    for (const g of state.groups) g.active = true;
    cb.onSettingsChange(state.settings);
    notifyGroupsChanged();
    saveState(state);
    // Rebuild the panel with new values
    // (Easiest: reload entire controls section)
    location.reload();
  });
  displayBody.appendChild(resetBtn);

  parent.appendChild(advSection);

  // Suppress unused-import warning for typeLabel (kept for future use in group labels)
  void typeLabel;

  return {
    initialState() {
      return state;
    },
    activeRules() {
      return activeRulesFromSpecs(state.groups);
    },
    advancedContainer() {
      return advExtras;
    },
  };
}
