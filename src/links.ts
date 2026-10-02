// The action buttons shown on every event, project and action: a prominent "RSVP" button when there is a
// sign-up page, and "Link to website" for the group's own page about it. Used by the drawer, the Events /
// Projects / Actions pages, the calendar detail and the card on the map, so they all look the same.
import { h } from "./dom";

const SAFE = /^https?:\/\//i;
// Pages that are themselves the sign-up form (when no separate RSVP link was recorded).
const SIGNUP = /zoom\.us\/(webinar|meeting)\/register|eventbrite\.|mobilize\.us|actionnetwork\.org\/events|lu\.ma\/|forms\.gle\/|docs\.google\.com\/forms|\/rsvp\b|\/register\b|everyaction|secure\.ngpvan/i;

/** Where to RSVP: the recorded RSVP link, or the event's link when that link is itself a sign-up page. */
export function rsvpUrl(item: { rsvp_link?: string; link?: string }): string | null {
  if (item.rsvp_link && SAFE.test(item.rsvp_link)) return item.rsvp_link;
  if (item.link && SAFE.test(item.link) && SIGNUP.test(item.link)) return item.link;
  return null;
}

/** RSVP (events only) + Link to website, or null when there is nothing to link to. */
export function itemButtons(kind: "event" | "project" | "action", item: { rsvp_link?: string; link?: string }): HTMLElement | null {
  const rsvp = kind === "event" ? rsvpUrl(item) : null;
  const site = item.link && SAFE.test(item.link) && item.link !== rsvp ? item.link : null;
  if (!rsvp && !site) return null;
  const stop = (el: HTMLElement) => { el.addEventListener("click", (ev) => ev.stopPropagation()); return el; };
  return h("div", { class: "item-buttons" },
    rsvp ? stop(h("a", { class: "btn-rsvp", href: rsvp, target: "_blank", rel: "noopener noreferrer" }, "RSVP")) : null,
    site ? stop(h("a", { class: "btn-site", href: site, target: "_blank", rel: "noopener noreferrer" }, "Link to website ↗")) : null,
  );
}
