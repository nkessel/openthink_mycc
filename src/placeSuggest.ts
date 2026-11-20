/** Address / town suggestions as you type (Nov 20, round 9). Shared by the review page and, later, the map's own add forms.
 *  Uses Photon (OpenStreetMap data, free, no key), limited to Massachusetts. Suggestions only fill the text box:
 *  the server still places the pin from that text, so the pin and the suggestion always agree. */
export interface Place { label: string; lat: number; lng: number }
const MA_BBOX = "-73.55,41.2,-69.9,42.9";
const URL_BASE = "https://photon.komoot.io/api/";

export function placeLabel(p: Record<string, unknown>): string {
  const s = (k: string) => String(p[k] || "").trim();
  const street = [s("housenumber"), s("street")].filter(Boolean).join(" ");
  const place = street || (s("name") && s("name") !== s("city") ? s("name") : "");
  const town = s("city") || s("town") || s("village") || s("locality") || s("county");
  return [place, town, "MA", s("postcode")].filter(Boolean).join(", ").replace(/, MA, (\d{5})$/, ", MA $1");
}

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const r = await fetch(`${URL_BASE}?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${MA_BBOX}`, { signal });
  if (!r.ok) return [];
  const j = await r.json();
  const seen = new Set<string>();
  return ((j.features || []) as { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[])
    .filter((f) => !f.properties.state || f.properties.state === "Massachusetts")
    .map((f) => ({ label: placeLabel(f.properties), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    .filter((p) => p.label && !seen.has(p.label) && !!seen.add(p.label));
}

/** Adds a suggestion list under a text input. `onPick` runs after a suggestion is chosen (the input already holds it). */
export function attachPlaceSuggest(input: HTMLInputElement, onPick?: (p: Place) => void) {
  if (input.dataset.suggest) return;
  input.dataset.suggest = "1";
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "suggest"; list.setAttribute("role", "listbox"); list.hidden = true;
  input.insertAdjacentElement("afterend", list);
  let timer = 0, ctl: AbortController | null = null, hit = -1, items: Place[] = [];
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); hit = -1; };
  const mark = () => Array.from(list.children).forEach((li, i) => li.classList.toggle("on", i === hit));
  const pick = (p: Place) => {
    input.value = p.label; close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    onPick?.(p);
  };
  const show = () => {
    list.innerHTML = "";
    items.forEach((p, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option"); li.textContent = p.label;
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(items[i]); });
      list.appendChild(li);
    });
    list.hidden = !items.length; input.setAttribute("aria-expanded", String(!list.hidden));
  };
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3 || input.dataset.picked === q) { close(); return; }
    timer = window.setTimeout(async () => {
      ctl?.abort(); ctl = new AbortController();
      try { items = await searchPlaces(q, ctl.signal); show(); } catch { /* offline or aborted: typing still works */ }
    }, 350);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hit = (hit + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; mark(); }
    else if (e.key === "Enter" && hit >= 0) { e.preventDefault(); e.stopPropagation(); pick(items[hit]); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
}
