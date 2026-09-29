// Warning shown on every project, event and action: the details were gathered from public pages and
// may be wrong or stale. Links to the matching Google Form (pre-filled with the group) to fix them.
import type { GraphNode } from "./types";
import { formUrl, type FormKind } from "./fab";
import { h } from "./dom";

/** Events and projects have their own forms; actions have none yet, so they go to the feedback form. */
export function staleNotice(kind: "project" | "event" | "action", owner: GraphNode | null): HTMLElement {
  const form: FormKind = kind === "action" ? "feedback" : kind;
  const url = formUrl(form, kind === "action" ? null : owner);
  const box = h("div", { class: "stale-notice" }, h("span", {}, "⚠ May be inaccurate or out of date. Gathered from public web pages, not confirmed by the group. "));
  if (url) box.appendChild(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Update this info ↗"));
  return box;
}
