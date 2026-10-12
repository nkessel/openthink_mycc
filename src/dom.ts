// Tiny safe DOM-builder. All text goes through textContent — no innerHTML.

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h(
  tag: string,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") {
      el.className = String(v);
    } else if (k === "style") {
      el.setAttribute("style", String(v));
    } else if (k.startsWith("on") && typeof v === "string") {
      // not supported; use addEventListener directly
      continue;
    } else {
      el.setAttribute(k, String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el: Element, text: string): void {
  el.textContent = text;
}

function appendChildren(parent: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === "string") {
      parent.appendChild(document.createTextNode(c));
    } else {
      parent.appendChild(c);
    }
  }
}

/** On phones: fold a panel behind one button (closed at first), keeping `keep` (e.g. its search box) in view. */
export function makeFoldable(panel: HTMLElement, label: string, keep: HTMLElement[] = []): void {
  panel.classList.add("foldable");
  for (const k of keep) k.classList.add("fold-keep");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "panel-fold";
  const phone = () => window.matchMedia("(max-width: 720px)").matches;
  const set = (open: boolean) => {
    panel.classList.toggle("folded", !open);
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = `${open ? "Hide" : "Show"} ${label} ${open ? "\u25B4" : "\u25BE"}`;
  };
  btn.addEventListener("click", () => set(panel.classList.contains("folded")));
  set(!phone());
  panel.insertBefore(btn, keep.length ? keep[keep.length - 1].nextSibling : panel.firstChild);
}
