// Which topic list the Topics page (and item cards) use:
//  - "wiki":   "Wikipedia topics" (Turibius Rozario's list, 13 main topics), the default
//  - "groups": "Topics named by groups", built from how the groups describe their own work
// Chosen with the Topics switch on the Topics page's bar (each option has an ⓘ); remembered in this browser.
// A link can force one with ?topics=wiki or ?topics=groups.

export type TopicList = "wiki" | "groups";
// v2 (Oct 24): everyone starts on Wikipedia topics again.
const STORE = "openthink.topicList.v2";

export const TOPIC_LISTS: { id: TopicList; label: string; hint: string; about: string[]; file: string }[] = [
  {
    id: "wiki",
    label: "Wikipedia topics",
    hint: "Shared, standard topic names from Wikipedia, under 13 main topics.",
    about: [
      "The map's main topic list, made by Turibius Rozario. It starts from 13 main topics (such as Climate change, Climate justice, Public transport, Energy poverty and Green New Deal), drawn from the UN's development goals and MYCC's priorities.",
      "Under each one are the Wikipedia articles most closely linked to it. A topic is kept only when it is strongly tied to its main topic, and one topic can sit under several main topics when it touches more than one issue.",
      "Good for: comparing work across groups and maps, because every group is sorted into the same well-known names, and the names link to a public source.",
    ],
    file: "topics-wiki.json",
  },
  {
    id: "groups",
    label: "Topics named by groups",
    hint: "Topics taken from how the groups describe their own events, projects and missions.",
    about: [
      "Built from the map itself: for every event, project, action and mission statement, the short topic phrases in its own description were picked out (only from the text, with a quote as evidence for each), then grouped by hand into 18 main topics and about 75 sub-topics, such as Buildings & home energy or Forests, land & nature. Bills a group names show under Climate policy & legislation.",
      "Good for: seeing the work the way the groups put it, including local issues (a particular compressor station or river) that a standard list doesn't name.",
      "It's an early draft the team hasn't finished reviewing, and it only covers what the groups have written so far.",
    ],
    file: "topics.json",
  },
];

function fromUrl(): TopicList | null {
  const v = new URLSearchParams(location.search).get("topics");
  return v === "wiki" || v === "groups" ? v : null;
}

let current: TopicList = (() => {
  const u = fromUrl();
  if (u) return u;
  try {
    const s = localStorage.getItem(STORE);
    if (s === "wiki" || s === "groups") return s;
  } catch {
    /* ignore */
  }
  return "wiki";
})();

const listeners = new Set<(l: TopicList) => void>();

export function topicList(): TopicList {
  return current;
}
export function topicListInfo() {
  return TOPIC_LISTS.find((l) => l.id === current)!;
}
export function topicsUrl(): string {
  return `${import.meta.env.BASE_URL}${topicListInfo().file}`;
}
export function setTopicList(l: TopicList) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(STORE, l);
  } catch {
    /* ignore */
  }
  for (const f of listeners) f(l);
}
export function onTopicListChange(f: (l: TopicList) => void) {
  listeners.add(f);
}

/** The "Topic list" control for Advanced display settings. */
export function topicListControl(): HTMLElement {
  const box = document.createElement("div");
  box.className = "control topic-list-control";
  const label = document.createElement("label");
  label.className = "ctrl-label";
  label.htmlFor = "topic-list-select";
  label.textContent = "Topic list";
  const sel = document.createElement("select");
  sel.id = "topic-list-select";
  sel.className = "ctrl-select";
  for (const l of TOPIC_LISTS) {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent = l.label;
    sel.appendChild(o);
  }
  sel.value = current;
  const hint = document.createElement("div");
  hint.className = "ctrl-hint";
  const setHint = () => (hint.textContent = topicListInfo().hint + " Used on the Topics page and item cards.");
  setHint();
  sel.addEventListener("change", () => {
    setTopicList(sel.value as TopicList);
    setHint();
  });
  onTopicListChange((l) => {
    sel.value = l;
    setHint();
  });
  box.append(label, sel, hint);
  return box;
}
