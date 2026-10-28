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
  for (const l of TOPIC_LISTS) {
    const b = h("button", { type: "button", "data-l": l.id, title: l.hint }, l.label) as HTMLButtonElement;
    b.addEventListener("click", () => setTopicList(l.id));
    // ⓘ: an info bubble on hover (or focus / tap on touch screens) saying how the list is made and what it's good for
    const tipId = `topics-tip-${l.id}`;
    const tip = h("div", { class: "topics-tip", role: "tooltip", id: tipId }, h("strong", {}, l.label), ...l.about.map((p) => h("p", {}, p)));
    const info = h("button", { type: "button", class: "topics-info", "aria-label": `What is "${l.label}"?`, "aria-describedby": tipId }, "i") as HTMLButtonElement;
    info.addEventListener("click", (e) => { e.stopPropagation(); wrapTip.classList.toggle("open"); });
    const wrapTip = h("span", { class: "topics-tipwrap" }, info, tip);
    info.addEventListener("blur", () => wrapTip.classList.remove("open"));
    listBtns.push(b);
    listSeg.append(b, wrapTip);
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
  // Each view's own options (Layout; the Command room's Show and "Fine-tune effects") live here on the top bar too
  // (Oct 24: no separate "Visual settings" button). Only the open view's options show.
  const layoutSlot = h("div", { class: "topics-layoutslot" });
  function adoptLayout(viewEl: HTMLElement, v: View) {
    const box = h("div", { class: "topics-viewopts", "data-view": v });
    for (const c of viewEl.querySelectorAll<HTMLElement>(".cr-bar > .cr-ctl, .cr-bar > .bt-fxbtn")) box.appendChild(c);
    layoutSlot.appendChild(box);
  }
  topicBar.append(h("div", { class: "cr-ctl" }, h("span", { class: "cr-ctl-label" }, "Topics"), listSeg), layoutSlot, fxControl());
  wrap.insertBefore(topicBar, body);

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
    // No "301 of 464 records tagged" line any more (Oct 24): it was bookkeeping, not something visitors need.
    count.textContent = "";
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
        adoptLayout(room.el, "streams");
      }
      if (view === "battle" && !battle) {
        battle = createBattle(ctx);
        stage.appendChild(battle.el);
        adoptLayout(battle.el, "battle");
      }
      for (const c of layoutSlot.children) (c as HTMLElement).hidden = (c as HTMLElement).dataset.view !== view;
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
