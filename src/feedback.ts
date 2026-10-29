// A friendly invitation to give feedback on something new, in place of a warning that it's unfinished.
import { h } from "./dom";
import { FORMS } from "./forms.config";

/** "<what> is new and still taking shape. <ask> →", linking to the feedback form (plain text when there is none). */
export function feedbackBid(what: string, ask = "What would make it more useful?"): HTMLElement {
  const url = FORMS.feedback?.url;
  const lead = h("span", { class: "fb-lead" }, `${what} is new and still taking shape.`);
  if (!url) return h("span", { class: "feedback-bid" }, lead);
  return h("a", { class: "feedback-bid", href: url, target: "_blank", rel: "noopener noreferrer", title: "Opens the feedback form" },
    h("span", { class: "fb-dot", "aria-hidden": "true" }), lead, " ", h("span", { class: "fb-ask" }, `${ask} Tell us →`));
}
