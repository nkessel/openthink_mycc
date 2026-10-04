// Topics page: where the groups' energy flows (the streams view lives in src/commandroom.ts).
// Records come from public/topics.json (built by scripts/topic-tags.mjs): main topics → sub-topics, with bills
// inside "Climate policy & legislation". Each stream's size is a weighted sum of a group's records for a topic,
// and the sliders here set those weights. The topic list is a draft under team review.
import * as d3 from "d3";
import { h } from "./dom";
import { currentMap, MAPS, type MapId } from "./maps";
import { createCommandRoom } from "./commandroom";
import { createBattle } from "./battle";

export interface TopicRecord {
  id: string;
  map: string;
  kind: "event" | "project" | "action" | "org_mission" | "coalition_mission";
  name: string;
  host: string;
  host_name: string;
  topics: string[];
  bills: string[];
  strategies: string[];
  recurring: boolean;
  climate_relevance: "core" | "adjacent" | "none";
  date?: string;
  status?: string;
  link?: string;
}

export interface TopicsFile {
  generated_at: string;
  status: string;
  parents: { id: string; label: string; children: { id: string; label: string }[] }[];
  bills: { id: string; name: string; map: string }[];
  records: TopicRecord[];
}

export interface TopicsCallbacks {
  /** Show this group on the map (its id in the map data); false when it isn't on this map. */
  onGroupClick(hostId: string): boolean;
  hasGroup(hostId: string): boolean;
  /** The group's logo URL, if it has one. */
  logoOf?(hostId: string): string | undefined;
}

interface Weights {
  project: number;
  event: number;
  action: number;
  recurring: number;
  recency: number;
  mission: number;
  cap: number;
  related: number;
}

const DEFAULTS: Weights = { project: 0.6, event: 0.5, action: 0.5, recurring: 0.5, recency: 0.3, mission: 0.15, cap: 0.5, related: 0.4 };
const SLIDERS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "project", label: "Projects", hint: "How much each project counts." },
  { key: "event", label: "Events", hint: "How much each event counts." },
  { key: "action", label: "Actions", hint: "How much each action or volunteer role counts." },
  { key: "recurring", label: "Recurring events", hint: "Events that repeat (weekly meetings, standing vigils). Middle = same as one-off events." },
  { key: "recency", label: "Recency", hint: "How much newer activity counts over older. Lowest = age doesn't matter." },
  { key: "mission", label: "Mission statements", hint: "A second layer: what groups say they work on, even with no current events." },
  { key: "cap", label: "Cap per group", hint: "Limits how much one group can add to a topic. Lowest = no limit." },
  { key: "related", label: "Related issues", hint: "Records about related issues (peace, housing, health…) or with no climate link." },
];
const STORE = "openthink.topics.v1";
const VIEW_STORE = "openthink.topics.view.v2";
type View = "streams" | "battle";

function loadWeights(): Weights {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Weights>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

/** Age in days used by the recency slider (0 = current). */
function ageDays(r: TopicRecord, today: number): number {
  if (r.kind === "event" && r.date) {
    const t = Date.parse(r.date);
    return Number.isFinite(t) ? Math.max(0, (today - t) / 86400000) : 180;
  }
  if (r.kind === "project") return r.status === "completed" ? 730 : r.status ? 0 : 365;
  if (r.kind === "action") return 90;
  return 0; // mission statements describe the group now
}

export function createTopicsView(cb: TopicsCallbacks): { el: HTMLElement; show(): void } {
  const wrap = h("div", { class: "list-view topics-view" });
  const toolbar = h("div", { class: "list-toolbar" });
  toolbar.appendChild(h("h2", {}, "Topics"));
  const count = h("span", { class: "count" }, "");
  toolbar.appendChild(count);
  toolbar.appendChild(
    h("span", { class: "topics-draft" }, "Draft: this topic list is still under team review, so names and groupings will change."),
  );
  // two views over the same data: energy streaming into topics, or the command room (problems vs. what we build)
  const viewSwitch = h("div", { class: "cr-seg topics-viewswitch", role: "group", "aria-label": "View" });
  const viewBtns: HTMLButtonElement[] = [];
  for (const [v, label] of [["streams", "Streams"], ["battle", "Command room"]] as const) {
    const b = h("button", { type: "button", "data-v": v }, label) as HTMLButtonElement;
    b.addEventListener("click", () => setView(v));
    viewBtns.push(b);
    viewSwitch.appendChild(b);
  }
  toolbar.insertBefore(viewSwitch, count);
  wrap.appendChild(toolbar);

  const body = h("div", { class: "topics-body" });
  wrap.appendChild(body);
  const panel = h("div", { class: "topics-panel" });
  const stage = h("div", { class: "topics-stage" });
  const detail = h("div", { class: "topics-detail" });
  body.append(panel, stage, detail);

  const weights = loadWeights();
  let file: TopicsFile | null = null;
  let loading: Promise<void> | null = null;
  let room: ReturnType<typeof createCommandRoom> | null = null;
  let battle: ReturnType<typeof createBattle> | null = null;
  let view: View = "streams";
  try {
    if (localStorage.getItem(VIEW_STORE) === "battle") view = "battle";
  } catch {
    /* ignore */
  }
  let makeViews: (() => void) | null = null;
  function applyView() {
    for (const b of viewBtns) b.classList.toggle("on", b.dataset.v === view);
    makeViews?.();
    const on = view === "streams" ? room : battle;
    const off = view === "streams" ? battle : room;
    if (off) {
      off.hide();
      off.el.style.display = "none";
    }
    if (on) {
      on.el.style.display = "";
      on.show();
    }
  }
  function setView(v: View) {
    if (v === view) return;
    view = v;
    try {
      localStorage.setItem(VIEW_STORE, v);
    } catch {
      /* ignore */
    }
    applyView();
  }
  for (const b of viewBtns) b.classList.toggle("on", b.dataset.v === view);

  // ---- Sliders ----
  panel.appendChild(h("div", { class: "topics-panel-head" }, "Stream size"));
  panel.appendChild(h("div", { class: "ctrl-hint" }, "Each stream is the weighted count of a group's events, projects, actions and mission statements on that topic."));
  const inputs = new Map<keyof Weights, HTMLInputElement>();
  for (const s of SLIDERS) {
    const box = h("div", { class: "control topics-slider" });
    box.appendChild(h("label", { class: "ctrl-label", for: `ts-${s.key}` }, s.label));
    const input = h("input", { id: `ts-${s.key}`, type: "range", min: "0", max: "1", step: "0.01", value: String(weights[s.key]), class: "slider", "data-key": s.key }) as HTMLInputElement;
    input.addEventListener("input", () => {
      weights[s.key] = parseFloat(input.value);
      try {
        localStorage.setItem(STORE, JSON.stringify(weights));
      } catch {
        /* ignore */
      }
      room?.update();
      battle?.update();
    });
    inputs.set(s.key, input);
    box.appendChild(input);
    box.appendChild(h("div", { class: "topics-scale" }, h("span", {}, "Not important"), h("span", {}, "Important")));
    box.appendChild(h("div", { class: "ctrl-hint" }, s.hint));
    panel.appendChild(box);
  }
  const reset = h("button", { class: "reset-btn", type: "button" }, "Reset sliders");
  reset.addEventListener("click", () => {
    Object.assign(weights, DEFAULTS);
    for (const [k, el] of inputs) el.value = String(weights[k]);
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
    room?.update();
    battle?.update();
  });
  panel.appendChild(reset);

  // ---- Weighting ----
  const today = Date.now();
  function weight(r: TopicRecord): number {
    const isMission = r.kind === "org_mission" || r.kind === "coalition_mission";
    let w = isMission ? weights.mission : weights[r.kind as "event" | "project" | "action"];
    if (r.recurring && r.kind === "event") w *= 2 * weights.recurring;
    if (weights.recency > 0) w *= Math.exp((-3 * weights.recency * ageDays(r, today)) / 365);
    if (r.climate_relevance !== "core") w *= weights.related;
    return w;
  }

  function setup(f: TopicsFile) {
    const mapIds: string[] = currentMap.combine ? [...currentMap.combine] : [currentMap.id];
    const recs = f.records.filter((r) => mapIds.includes(r.map));
    const tagged = recs.filter((r) => r.topics.length || r.bills.length).length;
    count.textContent = `${tagged} of ${recs.length} records tagged · ${mapIds.map((m) => MAPS[m as MapId]?.name ?? m).join(" + ")}`;
    // one colour per main topic (in list order, among those with records on this map)
    const present = f.parents.filter((p) => recs.some((r) => r.topics.some((t) => p.children.some((c) => c.id === t)))).map((p) => p.id);
    const hue = new Map(present.map((id, i) => [id, d3.hsl((i * 360) / present.length + 200, 0.55, 0.6).formatHex()]));
    const ctx = {
      file: f,
      mapIds,
      weight,
      cap: () => (weights.cap <= 0 ? Infinity : 1 + (1 - weights.cap) * 9),
      colorOf: (pid: string) => hue.get(pid) ?? "#38bdf8",
      detail,
      cb,
    };
    // each view is built the first time it is shown
    makeViews = () => {
      if (view === "streams" && !room) {
        room = createCommandRoom(ctx);
        stage.appendChild(room.el);
      }
      if (view === "battle" && !battle) {
        battle = createBattle(ctx);
        stage.appendChild(battle.el);
      }
    };
    applyView();
  }

  function show() {
    if (file) applyView();
    if (file || loading) return;
    loading = fetch(`${import.meta.env.BASE_URL}topics.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`topics.json: ${r.status}`);
        return r.json() as Promise<TopicsFile>;
      })
      .then((f) => {
        file = f;
        setup(f);
      })
      .catch((err) => {
        stage.appendChild(h("div", { class: "list-empty" }, `Couldn't load the topic data (${(err as Error).message}).`));
      });
  }

  return { el: wrap, show };
}
