// Which topic list the Topics page (and item cards) use:
//  - "wiki":   Wikipedia-based topics (Turibius Rozario's list, 13 seed topics) — the default
//  - "groups": group-based topics, built from how the groups describe their own work
// Chosen in the Topics page's Topic settings; remembered in this browser.
// A link can force one with ?topics=wiki or ?topics=groups.

export type TopicList = "wiki" | "groups";
const STORE = "openthink.topicList";

export const TOPIC_LISTS: { id: TopicList; label: string; hint: string; file: string }[] = [
  { id: "wiki", label: "Wikipedia-based", hint: "Topics from Wikipedia, grouped under 13 seed topics (UN goals and MYCC priorities).", file: "topics-wiki.json" },
  { id: "groups", label: "Group-based", hint: "Topics built from how the groups describe their own work.", file: "topics.json" },
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
    o.textContent = l.id === "wiki" ? `${l.label} (default)` : l.label;
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
