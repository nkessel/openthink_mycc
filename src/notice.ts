// Warning shown on every project, event and action: the details were gathered from public pages and
// may be wrong or stale. Links to the matching Google Form (pre-filled with the group) to fix them.
import type { GraphNode } from "./types";
import { formUrl, type FormKind } from "./fab";
import { FORMS } from "./forms.config";
import { h } from "./dom";

/** Events, projects and actions each have their own form (actions fall back to feedback until it is connected). */
export function staleNotice(kind: "project" | "event" | "action", owner: GraphNode | null): HTMLElement {
  // Until the actions form is connected (forms.config.ts), actions fall back to the feedback form.
  const form: FormKind = kind === "action" && !FORMS.action.url ? "feedback" : kind;
  const url = formUrl(form, form === "feedback" ? null : owner);
  const box = h("div", { class: "stale-notice" }, h("span", {}, "⚠ May be inaccurate or out of date. Gathered from public web pages, not confirmed by the group. "));
  if (url) box.appendChild(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Update this info ↗"));
  return box;
}
