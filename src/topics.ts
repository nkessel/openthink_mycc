// Topics page: where the groups' energy flows (the streams view lives in src/commandroom.ts).
// Records come from public/topics.json (built by scripts/topic-tags.mjs): main topics → sub-topics, with bills
// inside "Climate policy & legislation". Each stream's size is a weighted sum of a group's records for a topic,
// and the sliders here set those weights. The topic list is a draft under team review.
import * as d3 from "d3";
import { h, clear } from "./dom";
import { currentMap, MAPS, type MapId } from "./maps";
import { createCommandRoom } from "./commandroom";
import { createBattle } from "./battle";
import { feedbackBid } from "./feedback";
import { topicsUrl, topicListInfo, onTopicListChange, topicList, setTopicList, TOPIC_LISTS, type TopicList } from "./topiclist";
import { fxControl } from "./perf";
import { withLiveTags } from "./topiclive";
import type { DataFile } from "./types";

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
  /** True when the map data has this record's event, project or action (record ids are "<map>:<item id>"). */
  hasItem?(recordId: string): boolean;
  /** Show the item's detail card, the same one the Events page uses. */
  openItem?(recordId: string, at?: { x: number; y: number }): void;
  /** The map data, so topics groups add through the forms show up before the research files are rebuilt. */
  data?(): DataFile;
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
const VIEW_STORE = "openthink.topics.view.v2";
type View = "streams" | "battle";


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
  toolbar.appendChild(feedbackBid("This Topics page", "Do the topics, problems and solutions fit your work?"));
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
  // No settings panel on the left any more (Oct 24: "let's keep it simple and more lightweight"): the "What counts
  // more" weights stay at the site's defaults, and the topic list, visual effects and visual settings live on the bar.
  body.classList.add("no-panel");
  const stage = h("div", { class: "topics-stage" });
  const detail = h("div", { class: "topics-detail" });
  body.append(stage, detail);

  const weights: Weights = { ...DEFAULTS };
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

  // ---- The bar: which topic list (each with an ⓘ that says what it is), visual effects, visual settings ----
  const topicBar = h("div", { class: "topics-bar" });
  const listSeg = h("div", { class: "cr-seg topics-listseg", role: "group", "aria-label": "Topic list" });
  const listBtns: HTMLButtonElement[] = [];
  const infoBox = h("div", { class: "topics-listinfo", role: "region", "aria-live": "polite" });
  let infoFor: TopicList | null = null;
  const showInfo = (id: TopicList | null) => {
    infoFor = infoFor === id ? null : id;
    clear(infoBox);
    infoBox.classList.toggle("on", !!infoFor);
    for (const b of listSeg.querySelectorAll<HTMLButtonElement>(".topics-info")) b.setAttribute("aria-expanded", String(b.dataset.l === infoFor));
    if (!infoFor) return;
    const l = TOPIC_LISTS.find((x) => x.id === infoFor)!;
    const close = h("button", { type: "button", class: "topics-listinfo-close", "aria-label": "Close" }, "×");
    close.addEventListener("click", () => showInfo(null));
    infoBox.append(close, h("h4", {}, l.label), ...l.about.map((p) => h("p", {}, p)));
  };
  for (const l of TOPIC_LISTS) {
    const b = h("button", { type: "button", "data-l": l.id, title: l.hint }, l.label) as HTMLButtonElement;
    b.addEventListener("click", () => setTopicList(l.id));
    const info = h("button", { type: "button", class: "topics-info", "data-l": l.id, "aria-label": `What is "${l.label}"?`, "aria-expanded": "false", title: `What is "${l.label}"?` }, "i") as HTMLButtonElement;
    info.addEventListener("click", (e) => { e.stopPropagation(); showInfo(l.id); });
    listBtns.push(b);
    listSeg.append(b, info);
  }
  const syncList = () => {
    for (const b of listBtns) {
      const on = b.dataset.l === topicList();
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  syncList();
  onTopicListChange(syncList);
  // Visual settings: the views' own options (layout, what to show, the Command room's effect sliders), folded away.
  const visBtn = h("button", { type: "button", class: "cr-info topics-visbtn", "aria-expanded": "false" }, "⚙ Visual settings") as HTMLButtonElement;
  visBtn.addEventListener("click", () => {
    const on = !wrap.classList.contains("visual-open");
    wrap.classList.toggle("visual-open", on);
    visBtn.setAttribute("aria-expanded", String(on));
  });
  topicBar.append(h("div", { class: "cr-ctl" }, h("span", { class: "cr-ctl-label" }, "Topics"), listSeg), fxControl(), visBtn);
  wrap.insertBefore(topicBar, body);
  wrap.insertBefore(infoBox, body);

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
    count.textContent = `${topicListInfo().label} · ${tagged} of ${recs.length} records tagged · ${mapIds.map((m) => MAPS[m as MapId]?.name ?? m).join(" + ")}`;
    count.title = `${topicListInfo().hint} Change it with the Topics switch above.`;
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
    const url = topicsUrl();
    loading = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url.split("/").pop()}: ${r.status}`);
        return r.json() as Promise<TopicsFile>;
      })
      .then((f) => {
        const mapIds: string[] = currentMap.combine ? [...currentMap.combine] : [currentMap.id];
        return cb.data ? withLiveTags(f, cb.data(), mapIds, topicList() === "wiki") : f;
      })
      .then((f) => {
        if (url !== topicsUrl()) return; // the list was switched while this one loaded
        file = f;
        setup(f);
      })
      .catch((err) => {
        stage.appendChild(h("div", { class: "list-empty" }, `Couldn't load the topic data (${(err as Error).message}).`));
      });
  }

  // Switching the topic list (Advanced display settings) rebuilds both views from the other file.
  onTopicListChange(() => {
    for (const v of [room, battle]) {
      v?.hide();
      v?.el.remove();
    }
    room = battle = null;
    makeViews = null;
    file = null;
    loading = null;
    detail.replaceChildren();
    stage.replaceChildren();
    count.textContent = "";
    if (wrap.isConnected && wrap.offsetParent !== null) show();
  });

  return { el: wrap, show };
}
