// The action buttons shown on every event, project and action: a prominent "RSVP" button when there is a
// sign-up page, and a link to the page about it, named for what it is ("Event page", "Sign the petition"…). Used by the drawer, the Events /
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

/** What the link button says: what the page is, from the address first, then from the kind of item. */
export function linkLabel(kind: "event" | "project" | "action", url: string, actionKind?: string): string {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    /* ignore */
  }
  if (/\.pdf($|\?)/i.test(url)) return "Read the PDF";
  if (/petition|\/letters?\/|actionnetwork\.org\/(petitions|letters)|change\.org/i.test(url)) return "Sign the petition";
  if (/donate|givebutter|actblue|givelively/i.test(url)) return "Donate";
  if (/malegislature\.gov\/Bills|legislature\.vermont\.gov\/bill|congress\.gov\/bill/i.test(url)) return "Read the bill";
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return "Watch the video";
  if (/facebook\.com\/events/i.test(url)) return "Event on Facebook";
  if (/instagram\.com|facebook\.com|twitter\.com|x\.com\//i.test(url)) return "See the post";
  if (/docs\.google\.com\/forms|forms\.gle|\/(signup|sign-up|join|volunteer)\b/i.test(url)) return kind === "action" && actionKind === "role" ? "Sign up to volunteer" : "Sign up";
  if (path === "/" || path === "") return "Group's website";
  if (kind === "event") return "Event page";
  if (kind === "project") return "Project page";
  return actionKind === "role" ? "Volunteer page" : "Take action";
}

/** RSVP (events only) + a link to the item's page, or null when there is nothing to link to. */
export function itemButtons(kind: "event" | "project" | "action", item: { rsvp_link?: string; link?: string; kind?: string }): HTMLElement | null {
  const rsvp = kind === "event" ? rsvpUrl(item) : null;
  const site = item.link && SAFE.test(item.link) && item.link !== rsvp ? item.link : null;
  if (!rsvp && !site) return null;
  const stop = (el: HTMLElement) => { el.addEventListener("click", (ev) => ev.stopPropagation()); return el; };
  return h("div", { class: "item-buttons" },
    rsvp ? stop(h("a", { class: "btn-rsvp", href: rsvp, target: "_blank", rel: "noopener noreferrer" }, "RSVP")) : null,
    site ? stop(h("a", { class: "btn-site", href: site, target: "_blank", rel: "noopener noreferrer" }, `${linkLabel(kind, site, item.kind)} ↗`)) : null,
  );
}
