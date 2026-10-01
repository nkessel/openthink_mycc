# State climate-coalition research — instructions for one state

You are researching **one US state** for a climate-coalition map (like the existing Massachusetts map at
https://nkessel.github.io/openthink_mycc/). Output one JSON file the site can load directly.

## What to find

1. **Coalitions** active in the state: groups whose members are other organizations and that work on climate,
   clean energy, environmental justice, or climate-adjacent policy (e.g. a state Climate Action Network,
   "<State> Power Forward"-style coalitions, EJ alliances, youth climate coalitions, faith climate networks,
   statewide clean-energy coalitions). A national network's state chapter counts only if it acts as a coalition
   in that state. Aim for every real one; small states may have 3–6, large states 10–25.
2. **Member organizations** of each coalition, taken from the coalition's own member/partner/steering list.
   Do not guess membership. If a coalition publishes no member list, keep the coalition with `member_ids: []`.
3. **Other climate organizations** active in the state that are not in any coalition you found, if they are
   clearly significant (state chapters of Sierra Club, 350, Sunrise hubs, Citizens' Climate Lobby chapters,
   Mothers Out Front, state EJ groups, etc.). Cap these at ~40 per state.
4. **Upcoming events (today is 2026-10-01; only events on or after that date), current projects, and open
   actions / volunteer roles** posted on the groups' own sites or event pages (Mobilize, Action Network,
   Eventbrite, Facebook event pages are fine if public). Skip anything you cannot date.

## Where to start (seed sources, then search outward)

- Climate Action Network / state CAN members; US Climate Action Network member list (filter to the state)
- 350.org local groups map, Sunrise Movement hubs list, Citizens' Climate Lobby chapter list,
  Sierra Club state chapter, Mothers Out Front, Third Act, Interfaith Power & Light state affiliate,
  League of Conservation Voters state affiliate, Green New Deal / EJ state coalitions
- Search: "<state> climate coalition", "<state> environmental justice alliance", "<state> clean energy coalition members"

## Rules

- **Every fact needs a source.** Put the page(s) you read in a `sources` array on every coalition, organization,
  event, project and action. No source → leave it out. Never invent members, dates, coordinates or URLs.
- Use the group's own website for `website`. Leave `logo` out (filled in later).
- `lat`/`lng`: the org's HQ/office or home town centre (a town centre is fine; set `profile.geo_precision` to
  `"approx"` then, `"exact"` for a street address). If no location at all, use the state capital and set
  `remote: true`.
- `last_activity`: the newest date you saw for the group (ISO date). If you saw nothing from 2025–2026, set
  `profile.inactive: true` and say why in `description`.
- ids: lowercase snake_case of the name, prefixed with the state code, e.g. `ri_climate_action_ri`.
  Event/project/action ids: `<owner id>_e_<slug>`, `_p_`, `_a_`.
- `type`: one or more of `501c3, 501c4, coalition, school_club, campus_group, faith_org, mutual_aid,
  government, business, union, informal_group, unknown` (comma-separated).
- Events: `date` as `YYYY-MM-DDTHH:MM:SS` local time, or `YYYY-MM-DD` if no time posted. `location` text.
  `online: true` for virtual. `verified: true` only when the date comes from the host's own page.
  Projects: `status` one of active / planning / completed. Actions: `kind` "task" or "role", `deadline` or null.
- Put an org's own events/projects/actions on the org; coalition-run ones on the coalition. Set `host_org_id`
  when a coalition item is hosted by a member org.
- Keep descriptions to 1–2 plain sentences in your own words.
- Text fields (`location`, `description`, names) are shown to the public: no research notes in them. Put doubts in `notes`.
- `last_activity`: leave it `""` when you saw no dated activity. Never use today's date as a placeholder.
- Save the file after each coalition so progress is not lost.
- Coalition `color`: pick distinct pleasant hex colours. `abbrev`: short name. `geographic_scope`: e.g. "Statewide".
  `member_count` = length of `member_ids`.
- `edges`: one `{ "source": coalition id, "target": org id }` per membership.

## Output

Write the file to the path you were given. Shape (TypeScript types from the site, plus `sources`):

```json
{
  "generated_at": "2026-10-01T00:00:00Z",
  "state": "RI",
  "coalitions": [ { "id": "", "name": "", "abbrev": "", "description": "", "focus_tags": [], "geographic_scope": "",
      "color": "#38bdf8", "lat": 0, "lng": 0, "member_ids": [], "member_count": 0, "website": "",
      "projects": [], "events": [], "actions": [], "last_activity": "", "sources": [] } ],
  "organizations": [ { "id": "", "name": "", "abbrev": "", "type": "", "geographic_focus": "", "description": "",
      "coalition_ids": [], "lat": 0, "lng": 0, "last_activity": "", "website": "", "topic_tags": [],
      "profile": { "geo_precision": "approx" }, "projects": [], "events": [], "actions": [], "sources": [] } ],
  "edges": [ { "source": "", "target": "" } ],
  "notes": "What you could not find, coalitions with no public member list, anything uncertain."
}
```

Validate the JSON parses before you finish (e.g. `python3 -c "import json;json.load(open(PATH))"`).
Finish with a short summary: counts, coalitions without member lists, and anything doubtful.
