# Topic extraction: instructions

Goal: find out **where the coalition's organizing energy goes**. For every event, project, action and mission
statement on the map, record what problem or solution area it works on (topics), how it works on it (strategies),
and any bills it names. The results are clustered into a two-level topic list (`hierarchy.md`), which the team
reviews. After review, every record is re-tagged against the final list for the "Topics" view.

Input: `records.json`, built by `node scripts/topic-records.mjs` from `public/data.json` and `public/maps/vt.json`.
Each record has `id`, `map`, `kind` (`event` | `project` | `action` | `org_mission` | `coalition_mission`),
`host_name`, `name`, `text` and sometimes `date`, `status` and `subkind`.

## Rules

- **Use only the record's own `name` and `text`.** No web searches and no outside knowledge about the group. If the
  text is too thin to say what the topic is, return no topics; never guess.
- **Every topic needs evidence:** an exact, short substring (≤ 12 words) of the name or text that shows it.
- Strategies are recorded separately from topics. "Lobbying for heat pump rebates" has the topic `heat pump
  rebates` and the strategy `policy_advocacy`. Do not use strategy words ("advocacy", "education") as topics.

## Output

One JSON array per slice, one object per input record, in input order:

```json
{
  "id": "ma:belmont_high_school_climate__p1",
  "topics": [
    { "phrase": "school composting", "evidence": "runs a lunchtime compost bin" }
  ],
  "strategies": ["building_and_stewardship", "education"],
  "bills": [],
  "recurring": false,
  "climate_relevance": "core"
}
```

- `topics`: 1–4 for events, projects and actions; up to 6 for mission statements.
  - Each `phrase` is a short lowercase noun phrase of 1–5 words.
  - Make it as specific as the text allows: `weymouth compressor station` rather than `fossil fuels`. When the text
    also states the broader issue, add it as a second phrase (`fracked gas infrastructure`).
  - Name the issue, not the group, the place or the audience. Places only go in the phrase when the topic *is* a
    specific site or facility.
- `strategies`: 1–3, from this list only.

  | Strategy | Meaning |
  |---|---|
  | `policy_advocacy` | lobbying, contacting officials, testimony, petitions to government, regulatory comment |
  | `electoral` | candidate endorsements, voter registration and turnout, canvassing for candidates |
  | `organizing` | campaigns, protests, recruiting members, pressuring companies or institutions |
  | `education` | talks, screenings, workshops, courses, awareness, outreach |
  | `training` | skills, leadership or workforce training |
  | `direct_service` | doing something for people: energy assessments, compost pickup, food, legal aid |
  | `building_and_stewardship` | planting, installing, building, restoring, cleanups, gardens |
  | `individual_action` | asking people to change their own choices: opt into green power, switch to heat pumps |
  | `research` | studies, monitoring, data, mapping |
  | `legal` | litigation, legal interventions |
  | `finance` | investment, divestment, grants, fundraising for projects |
  | `community_building` | meetings, socials, networking, coalition-building |

- `bills`: each bill, ballot question or named piece of legislation the record names:
  `{ "name": "...", "number": "H.953" | null, "evidence": "..." }`. Leave it empty when legislation is only implied.
- `recurring`: `true` only when the text says it repeats (weekly, monthly, every, ongoing series). Otherwise `false`.
- `climate_relevance`:
  - `core`: climate, energy, environment or environmental justice.
  - `adjacent`: a related justice, health, labor, housing, peace or democracy issue.
  - `none`: no climate or environmental connection in the text.
- Optional `notes`: one line, only for a real problem, such as text that looks like an internal research note rather
  than a public description.

Validate the file with `node -e 'JSON.parse(require("fs").readFileSync(FILE))'` before finishing.
