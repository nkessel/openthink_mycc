# Fill missing details for Massachusetts organizations

The Massachusetts map (public/data.json) has 150 organizations, most missing a description, type, website
and geographic focus. You are given a slice of them. For each org in your slice, find on the public web:

- `description`: 1–2 plain sentences in your own words: what the group does on climate / environment /
  justice and who it is (e.g. "Student club at Newton South High School that runs campus composting and
  lobbies the city on climate."). No marketing language, no research notes.
- `type`: one or more of `501c3, 501c4, coalition, school_club, campus_group, faith_org, mutual_aid,
  government, business, union, informal_group` (comma-separated). Leave out if you cannot tell.
- `website`: the group's own site (or its official page on a parent org / school site, or its main public
  social page if it has no site). Only fill if the org has none yet.
- `geographic_focus`: where it works, e.g. "Newton", "Greater Boston", "Pioneer Valley", "Statewide".
- `inactive`: true only if you find clear signs it stopped (site gone, "on hiatus", nothing since 2023).
- `sources`: the page(s) you read. Every field needs a source page; no source → leave the field out.

Rules: never guess. Do not change names, ids, coordinates or coalition membership. Use WebSearch/WebFetch.
If a site blocks automated readers, use search-result text only when it plainly states the fact, and say so
in `notes`.

Output: write JSON to the path you were given, saving after every ~10 orgs:

```json
{ "orgs": { "<org id>": { "description": "", "type": "", "website": "", "geographic_focus": "",
                           "inactive": false, "sources": [] } },
  "not_found": ["<org id>", "..."],
  "notes": "anything doubtful" }
```

Include only the fields you actually found. Validate the JSON parses before finishing.
