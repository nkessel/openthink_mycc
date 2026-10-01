// Warning shown on every project, event and action: the details were gathered from public pages and
// may be wrong or stale. Links to the matching Google Form (pre-filled with the group) to fix them.
import type { GraphNode } from "./types";
import { formUrl, type FormKind } from "./fab";
import { FORMS } from "./forms.config";
import { h } from "./dom";
import { currentMap } from "./maps";

/** A real button (an <a> styled as one) that opens the form for this item. */
function editBtn(url: string, kind: string): HTMLElement {
  // Maps without their own forms send people to the feedback form instead.
  const label = currentMap.editable ? `Edit this ${kind}` : "Suggest a correction";
  return h("a", { class: "edit-btn", href: url, target: "_blank", rel: "noopener noreferrer" }, label);
}

/** Events, projects and actions each have their own form (actions fall back to feedback until it is connected). */
export function staleNotice(kind: "project" | "event" | "action", owner: GraphNode | null, needsInfo = false, verified = false, item: { id: string; name: string; date?: string; sheet_date?: string } | null = null): HTMLElement {
  // Until the actions form is connected (forms.config.ts), actions fall back to the feedback form.
  const form: FormKind = kind === "action" && !FORMS.action.url ? "feedback" : kind;
  const url = formUrl(form, form === "feedback" ? null : owner, form === "feedback" ? null : item);
  if (verified && !needsInfo) {
    // Confirmed on the group's own page: no warning, just a quiet note and the way to update it.
    const ok = h("div", { class: "stale-notice verified" });
    ok.appendChild(h("span", {}, "✓ Listed on the group's own page. "));
    if (url) ok.appendChild(editBtn(url, kind));
    return ok;
  }
  const box = h("div", { class: needsInfo ? "stale-notice needs-info" : "stale-notice" });
  box.appendChild(h("span", {}, needsInfo
    ? `⚠ Needs more information. We couldn't confirm this ${kind} is current. `
    : "⚠ May be inaccurate or out of date. Gathered from public web pages, not confirmed by the group. "));
  if (url) box.appendChild(editBtn(url, kind));
  return box;
}
