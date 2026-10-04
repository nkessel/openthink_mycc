# Find RSVP / sign-up links for upcoming events

You get `research/rsvp/input_<n>.json`: upcoming events (on or after 2026-10-04) that have no `rsvp_link`.
Each row has `event_id`, the host (`org`, `org_website`), `name`, `date`, `location` and the current `link`
(often just the group's general events page, sometimes blank).

For each event:

1. Open the current `link` (or the host's events/calendar page) with WebFetch and find **this event's own
   page** on the host's site (or the host's own listing on Eventbrite / Mobilize / Action Network / Zeffy /
   Humanitix / Facebook event etc. linked from the host's site).
2. `link`: the event's own page, only if it differs from the current `link` and the current one is a general
   listing (events page, calendar, homepage) or blank.
3. `rsvp_link`: the sign-up / registration / ticket / RSVP URL for this event as linked from the host's pages
   (Zoom registration, Eventbrite, Mobilize, Action Network, Google Form, the host's own registration form…).
   If the event page itself is the registration page (e.g. an Eventbrite or Mobilize page), use that URL.
   Leave out when the event has no registration (drop-in, "just show up") — then set `"no_registration": true`
   only if the page says so or plainly shows no sign-up.
4. `sources`: the page(s) where you saw the link (host's pages only). The event must be clearly the same event
   (same name or same date). Check the date matches; if the page shows a different date, record it in
   `date_on_page` instead of changing anything.
5. If the event is gone from the host's pages or cancelled, set `"not_listed": true` (or `"cancelled": true`
   when stated) with the page you checked as a source.

Rules: never guess a URL; only copy URLs you actually saw on the host's pages (or on the registration page
the host links to). Do not invent ids or change other fields. Prefer WebFetch on the given pages; use at most
about 1 WebSearch per host org (budget is tight). If a site blocks automated readers, say so in `notes` and
move on. Recurring events (e.g. weekly meetings) usually share one sign-up link — that is fine.

Output: write JSON to `research/rsvp/rsvp_<n>.json`, saving every ~10 events:

```json
{ "events": { "<event_id>": { "link": "", "rsvp_link": "", "no_registration": false, "not_listed": false,
                              "cancelled": false, "date_on_page": "", "sources": [] } },
  "not_checked": ["<event_id>"],
  "notes": "blocked sites, doubts" }
```

Include only the fields you found (always `sources`). Every input event must appear in `events` or
`not_checked`. Validate that the JSON parses before finishing.
