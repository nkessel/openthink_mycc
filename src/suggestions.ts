// "Holes": orgs doing similar things that aren't connected yet.
//
// Similarity blends: shared topic tags, similar descriptions/names (TF-IDF cosine),
// same org type, both youth-serving, shared skills needed, and being near each other.
// Pairs that already report working together (org_links) are never suggested; pairs in the
// same coalition are ranked lower, since they already have a place to meet.
// It gets better as groups fill in descriptions and tags through the forms.
import type { DataFile, Organization } from "./types";
import { orgProjects } from "./owners";

export interface Suggestion {
  a: string;
  b: string;
  score: number; // 0..1
  reasons: string[];
  sharedCoalition: boolean;
}

const STOP = new Set(
  ("a an and at by for from in into is of on or the to with our we us are be this that it as " +
    "ma massachusetts mass climate club coalition group org organization inc chapter team committee").split(" "),
);
const MIN_SCORE = 0.22;
const PER_ORG = 5;

const tokens = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

function km(a: Organization, b: Organization): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const jaccard = (x: Set<string>, y: Set<string>) => {
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const v of x) if (y.has(v)) n++;
  return n / (x.size + y.size - n);
};

let cache: { data: DataFile; list: Suggestion[] } | null = null;

export function computeSuggestions(data: DataFile): Suggestion[] {
  if (cache?.data === data) return cache.list;
  const orgs = data.organizations;

  // TF-IDF over name + description + tags
  const docs = orgs.map((o) => tokens(`${o.name} ${o.description} ${(o.topic_tags || []).join(" ")}`));
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const vecs = docs.map((d) => {
    const v = new Map<string, number>();
    d.forEach((w) => v.set(w, (v.get(w) || 0) + 1));
    let norm = 0;
    for (const [w, tf] of v) {
      const idf = Math.log(1 + orgs.length / (df.get(w) || 1));
      v.set(w, tf * idf);
      norm += (tf * idf) ** 2;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
  const cosine = (i: number, j: number) => {
    let s = 0;
    const [small, big] = vecs[i].size < vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
    for (const [w, x] of small) s += x * (big.get(w) || 0);
    return s;
  };

  const tags = orgs.map((o) => new Set(o.topic_tags || []));
  const skills = orgs.map((o) => new Set(orgProjects(data, o).flatMap((p) => p.skills_needed)));
  const linked = new Set((data.org_links || []).map((l) => [l.source, l.target].sort().join("|")));

  const out: Suggestion[] = [];
  for (let i = 0; i < orgs.length; i++) {
    for (let j = i + 1; j < orgs.length; j++) {
      const a = orgs[i], b = orgs[j];
      if (linked.has([a.id, b.id].sort().join("|"))) continue;
      const reasons: string[] = [];
      const text = cosine(i, j);
      const tagSim = jaccard(tags[i], tags[j]);
      const skillSim = jaccard(skills[i], skills[j]);
      const sameType = a.type === b.type && a.type !== "unknown" && a.type !== "other";
      const youth = !!(a.profile?.youth_serving && b.profile?.youth_serving);
      const bothExact = a.profile?.geo_precision !== "approx" && b.profile?.geo_precision !== "approx" && !a.remote && !b.remote;
      const dist = bothExact ? km(a, b) : Infinity;
      const near = dist < 15 ? 1 - dist / 15 : 0;

      const sameName = a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
      let score = 0.4 * text + 0.25 * tagSim + 0.1 * skillSim + (sameType ? 0.1 : 0) + (youth ? 0.07 : 0) + 0.08 * near;
      if (sameName) reasons.push("Same name — possibly a duplicate entry");
      else if (text >= 0.25) reasons.push(a.description && b.description ? "Similar descriptions" : "Similar names");
      if (tagSim > 0) {
        const shared = [...tags[i]].filter((t) => tags[j].has(t)).map((t) => t.replace(/_/g, " "));
        reasons.push(`Shared topics: ${shared.slice(0, 3).join(", ")}`);
      }
      if (skillSim > 0) reasons.push("Need similar skills");
      if (sameType) reasons.push(`Both ${a.type.replace(/_/g, " ")}s`);
      if (youth) reasons.push("Both youth-serving");
      if (near > 0) reasons.push(`About ${Math.max(1, Math.round(dist))} km apart`);

      const sharedCoalition = a.coalition_ids.some((c) => b.coalition_ids.includes(c));
      if (sharedCoalition) score *= 0.6;
      if (score >= MIN_SCORE && reasons.length) out.push({ a: a.id, b: b.id, score: Math.min(1, score), reasons, sharedCoalition });
    }
  }
  out.sort((x, y) => y.score - x.score);
  cache = { data, list: out };
  return out;
}

/** Top suggestions for one org (the other org's id + why). */
export function suggestionsFor(data: DataFile, orgId: string): { other: string; s: Suggestion }[] {
  return computeSuggestions(data)
    .filter((s) => s.a === orgId || s.b === orgId)
    .slice(0, PER_ORG)
    .map((s) => ({ other: s.a === orgId ? s.b : s.a, s }));
}
