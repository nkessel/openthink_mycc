# Fill out the Massachusetts and Vermont maps (2026-10-03)

Today is **2026-10-03**. You are given a slice of groups (`inN.json`) from the climate-coalition map
(https://nkessel.github.io/openthink_mycc/). Each entry has the group's `map` (ma / vt), `id`, `name`, what we
already have, `gaps` (empty fields), and `existing` events / projects / actions.

For every group in your slice, research **only the group's own public pages** (its website, its pages on Mobilize,
Action Network, Eventbrite, Facebook/Instagram public posts, its parent org's page about it, a school's page about
a school club) and record:

1. **Missing profile fields** (only the ones listed in `gaps`):
   - `description`: 1–2 plain sentences in your own words: what the group does on climate / environment / justice
     and who it is. No marketing language. No research notes ("could not find…", "site blocks readers").
   - `type`: one or more of `501c3, 501c4, coalition, school_club, campus_group, faith_org, mutual_aid, government,
     business, union, informal_group` (comma-separated). Only when the page shows it (e.g. "a 501(c)(3)", a school
     club page, a congregation's green team → faith_org, a town committee → government). Otherwise leave it out.
   - `website`: the group's own site, or its official page on a parent org / school site, or its main public social
     page if it has no site.
   - `geographic_focus`: where it works, e.g. "Newton", "Greater Boston", "Pioneer Valley", "Statewide", "Chittenden County".
   - `last_activity`: the newest dated activity you saw from the group (post, event, newsletter), as `YYYY-MM-DD`.
     Fill this for every group if you saw a date, even if not in `gaps` (we use the newest).
   - `inactive: true` only with clear signs it stopped (site gone, "on hiatus", nothing since 2024).
2. **New items** the group is running now (not already in `existing`, compare names loosely):
   - `events`: on or after 2026-10-03 only, with a date posted by the host. Shape:
     `{ "name", "date": "YYYY-MM-DDTHH:MM:SS" (local time) or "YYYY-MM-DD" if no time, "end"?: same format,
       "location": "place text" (or "Online"), "online"?: true, "recurrence"?: "Every Saturday, 12–1 PM",
       "description": "1 sentence", "link": "the event's own page", "rsvp_link"?: "sign-up page", "sources": [] }`
     For a repeating event, `date` is the next occurrence on or after 2026-10-03.
   - `projects`: ongoing campaigns / programs. `{ "name", "description", "status": "active"|"planning",
       "link", "sources": [] }`. Only ones the group presents as current (2025–2026).
   - `actions`: things the public can do now: sign a petition, testify, call legislators, join a campaign, donate to
     a specific campaign (kind "task"); or volunteer roles with a description (kind "role").
     `{ "name", "kind": "task"|"role", "description", "deadline": "YYYY-MM-DD" | null, "link", "sources": [] }`.
   Up to ~4 of each per group; prefer the most concrete and current.
3. **Better links for existing upcoming events** (`existing.events` with a date on/after 2026-10-03): if the event
   has its own page and/or a sign-up page, record `{ "link"?, "rsvp_link"? }` keyed by event id, with `sources`.

## Rules

- **Every fact needs a source URL you actually read.** No source → leave it out. Never guess dates, places or links.
- Public text only. **Never record personal email addresses or phone numbers**, or private individuals' names
  beyond a public speaker named on a public event page.
- Text fields are shown to the public: plain, neutral, no notes to us. Put doubts in the top-level `notes`.
- If the group's site blocks automated readers, you may use search-result snippets only when they plainly state the
  fact; say so in `notes`.
- You may use WebSearch, WebFetch, and `curl -sL` from the shell (shell web access works).
- Work through every group in the slice; spend more effort on groups with no items yet. If a group has no site
  and no findable public presence, list it in `not_found`.
- Save the output after every ~5 groups so progress is not lost. Validate it parses before finishing
  (`python3 -c "import json;json.load(open(PATH))"`).
- Do not edit anything outside your output file. Do not run git.

## Output (`outN.json`)

```json
{
  "groups": {
    "<id>": {
      "map": "ma",
      "fields": { "description": "", "type": "", "website": "", "geographic_focus": "", "last_activity": "", "inactive": false },
      "field_sources": ["https://…"],
      "events": [], "projects": [], "actions": [],
      "event_updates": { "<existing event id>": { "link": "", "rsvp_link": "", "sources": [] } }
    }
  },
  "not_found": ["<id>"],
  "notes": "anything doubtful, per group id"
}
```

Include only fields you actually found. Finish with a short summary: groups covered, items found, not found.
