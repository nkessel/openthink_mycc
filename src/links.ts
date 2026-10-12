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

/** A contact as links: emails become mailto: links, web addresses open in a new tab, phone numbers become tel: links.
 *  Anything else stays plain text. */
export function contactLinks(text: string): HTMLElement {
  const out = h("span", { class: "contact-links" });
  const re = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(https?:\/\/[^\s,;]+)|(www\.[^\s,;]+)|(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.append(text.slice(last, m.index));
    const [whole, email, url, www, phone] = m;
    const href = email ? `mailto:${email}` : url ? url : www ? `https://${www}` : `tel:${phone.replace(/[^\d+]/g, "")}`;
    const a = h("a", { href, ...(email || phone ? {} : { target: "_blank", rel: "noopener noreferrer" }) }, whole);
    a.addEventListener("click", (ev) => ev.stopPropagation());
    out.append(a);
    last = m.index! + whole.length;
  }
  if (last < text.length) out.append(text.slice(last));
  return out;
}

/** "How to join" for a project or volunteer role: its own contact or page, else its group's contact or website. */
export function joinInfo(item: { public_contact?: string; link?: string }, owner: { public_contact?: string; website?: string; name: string }): { text: string; via: "item" | "group" } | null {
  if (item.public_contact) return { text: item.public_contact, via: "item" };
  if (item.link && SAFE.test(item.link)) return { text: item.link, via: "item" };
  if (owner.public_contact) return { text: owner.public_contact, via: "group" };
  if (owner.website && SAFE.test(owner.website)) return { text: owner.website, via: "group" };
  return null;
}

/** Ongoing and asking for help: the group answered "Help wanted: yes" or listed skills it needs. */
export function wantsHelp(p: { help_wanted?: boolean; status?: string; skills_needed?: string[] }): boolean {
  if (p.status === "completed" || p.help_wanted === false) return false;
  return p.help_wanted === true || (p.skills_needed?.length ?? 0) > 0;
}

/** The "How to join" line for cards and the details pane. */
export function joinLine(item: { public_contact?: string; link?: string }, owner: { public_contact?: string; website?: string; name: string }): HTMLElement {
  const j = joinInfo(item, owner);
  if (!j) return h("div", { class: "join-line none" }, "How to join: not listed yet. Ask the group, or suggest a contact with the + button.");
  return h("div", { class: "join-line" }, h("strong", {}, "How to join: "), j.via === "group" ? `contact ${owner.name}, ` : "", contactLinks(j.text));
}
