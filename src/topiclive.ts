// Topics that groups add through the forms reach the map as each item's `topic_tags` (slugs of topic names) long
// before anyone re-runs the research that builds public/topics*.json. This folds those live tags into the
// Topics page's records, so a new organization's mission or a new event shows up under the topics it picked.
//  - A tag that names a topic already in the list (id or name) is added to that item's record.
//  - With the Wikipedia-based list, a tag naming any of Turibius's topics (public/topics-wiki-catalog.json) is
//    added under its seed topic, even if no research record used it yet.
//  - Items and groups that aren't in the research records yet get a new record.
import type { DataFile } from "./types";
import type { TopicsFile, TopicRecord } from "./topics";
import { allActions, allEvents, allProjects } from "./owners";

/** Same as the sheet script's slug_(), so a tag saved by a form matches a topic name here. */
export function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type Catalog = Record<string, string[]>; // [qid, name, seed qid, …more seed qids]
let catalog: Promise<Catalog | null> | null = null;
function loadCatalog(): Promise<Catalog | null> {
  catalog ??= fetch(`${import.meta.env.BASE_URL}topics-wiki-catalog.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .catch(() => null);
  return catalog;
}

interface LiveItem {
  key: string; // item id, or "<group id>:mission"
  kind: TopicRecord["kind"];
  name: string;
  host: string;
  host_name: string;
  tags: string[];
  date?: string;
  recurring: boolean;
}

function liveItems(data: DataFile): LiveItem[] {
  const out: LiveItem[] = [];
  const nameOf = new Map<string, string>([...data.coalitions, ...data.organizations].map((g) => [g.id, g.name]));
  const host = (owner: { node: { id: string }; name: string }, hostOrg?: string) =>
    hostOrg && nameOf.has(hostOrg) ? { host: hostOrg, host_name: nameOf.get(hostOrg)! } : { host: owner.node.id, host_name: owner.name };
  for (const c of data.coalitions) out.push({ key: `${c.id}:mission`, kind: "coalition_mission", name: c.name, host: c.id, host_name: c.name, tags: c.focus_tags || [], recurring: false });
  for (const o of data.organizations) out.push({ key: `${o.id}:mission`, kind: "org_mission", name: o.name, host: o.id, host_name: o.name, tags: o.topic_tags || [], recurring: false });
  for (const { event: e, owner } of allEvents(data)) out.push({ key: e.id, kind: "event", name: e.name, ...host(owner, e.host_org_id), tags: e.topic_tags || [], date: e.date, recurring: !!e.recurrence });
  for (const { project: p, owner } of allProjects(data)) out.push({ key: p.id, kind: "project", name: p.name, ...host(owner, p.host_org_id), tags: p.topic_tags || [], recurring: false });
  for (const { action: a, owner } of allActions(data)) out.push({ key: a.id, kind: "action", name: a.name, ...host(owner, a.host_org_id), tags: (a as { topic_tags?: string[] }).topic_tags || [], recurring: false });
  return out;
}

/**
 * A copy of `f` with the map data's live topic tags folded in. `mapIds` are the maps on screen; a brand-new
 * record needs exactly one (on a combined map we can't tell which state file an unknown item came from).
 */
export async function withLiveTags(f: TopicsFile, data: DataFile, mapIds: string[], wiki: boolean): Promise<TopicsFile> {
  const items = liveItems(data).filter((i) => i.tags.length);
  if (!items.length) return f;
  const parents = f.parents.map((p) => ({ ...p, children: [...p.children] }));
  const byTag = new Map<string, string>(); // slug → child id
  for (const p of parents) for (const c of p.children) {
    byTag.set(slug(c.id), c.id);
    byTag.set(slug(c.label.replace(/\s*\(general\)$/, "")), c.id);
  }
  const cat = wiki && items.some((i) => i.tags.some((t) => !byTag.has(slug(t)))) ? await loadCatalog() : null;
  const topicFor = (tag: string): string | null => {
    const s = slug(tag);
    const known = byTag.get(s);
    if (known) return known;
    const hit = cat?.[s];
    if (!hit) return null;
    const [qid, name, ...seedIds] = hit;
    const under = parents.filter((p) => seedIds.some((s) => p.id === `wiki_${s}`));
    if (!under.length) return null;
    for (const parent of under) parent.children.push({ id: qid, label: seedIds.includes(qid) ? `${name} (general)` : name });
    byTag.set(s, qid);
    return qid;
  };

  const records = f.records.map((r) => ({ ...r }));
  const bySuffix = new Map(records.map((r) => [r.id.slice(r.id.indexOf(":") + 1), r]));
  for (const it of items) {
    const topics = [...new Set(it.tags.map(topicFor).filter((x): x is string => !!x))];
    if (!topics.length) continue;
    const rec = bySuffix.get(it.key);
    if (rec) {
      rec.topics = [...new Set([...rec.topics, ...topics])];
      continue;
    }
    if (mapIds.length !== 1) continue;
    const r: TopicRecord = {
      id: `${mapIds[0]}:${it.key}`, map: mapIds[0], kind: it.kind, name: it.name, host: it.host, host_name: it.host_name,
      topics, bills: [], strategies: [], recurring: it.recurring, climate_relevance: "core", date: it.date,
    };
    records.push(r);
    bySuffix.set(it.key, r);
  }
  return { ...f, parents, records };
}
