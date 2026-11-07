#!/usr/bin/env python3
"""Agent 3: compare work/agent1.json and work/agent2.json -> work/final.json.
Run from anywhere: python3 compare_agents.py   (then: python3 5_check_quotes.py ../work/final.json)"""
import json, os
from collections import Counter
from urllib.parse import urlsplit

W = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'work')

# Add rows matched by hand: (group_id, A1 proposed_name) -> A2 proposed_name.
# Same-link or same-name (case-insensitive) add rows match automatically.
MANUAL_MATCHES = {
    # same composting page, same program, named differently
    ('boston_latin_school_youthcan', 'Composting at BLS'): 'BLS Composting Program',
    # same N2N Environmental Justice campaign, different URL/wording
    ('neighbor_to_neighbor_massachusetts', 'Environmental Justice campaign'): 'Environmental Justice',
    # same 350 Central Mass divestment campaign/page, named differently
    ('350ma_central_mass', 'Fossil fuel divestment campaign'): 'Fossil-Fuel Divestment',
}

KEYS = ['group_id', 'group_name', 'item_type', 'item_id', 'current_name', 'verdict', 'proposed_name',
        'proposed_description', 'proposed_link', 'proposed_date', 'evidence_url', 'evidence_quote', 'notes']


def load(n):
    return json.load(open(os.path.join(W, f'agent{n}.json')))


def nl(u):
    p = urlsplit((u or '').strip())
    return p.netloc.lower() + p.path.rstrip('/')


def spec(r):
    return len(r['proposed_description']) + len(r['evidence_quote'])


def pick(x, y):
    return x if (x['evidence_quote'] and spec(x) >= spec(y)) else y


def same_add(r, s):
    if r['group_id'] != s['group_id']:
        return False
    if MANUAL_MATCHES.get((r['group_id'], r['proposed_name'])) == s['proposed_name']:
        return True
    if r['item_type'] == s['item_type'] and r['proposed_name'].strip().lower() == s['proposed_name'].strip().lower():
        return True
    # same specific link (not a shared list page): only if link and type agree and date (if any) agree
    return (r['item_type'] == s['item_type'] and r['proposed_link'] and nl(r['proposed_link']) == nl(s['proposed_link'])
            and r['proposed_date'] == s['proposed_date'] and r['proposed_name'][:12].lower() == s['proposed_name'][:12].lower())


def main():
    a1, a2 = load(1), load(2)
    ex2 = {(r['group_id'], r['item_id']): r for r in a2 if r['item_id']}
    pairs = []
    for r in a1:
        if r['item_id']:
            pairs.append((r, ex2.pop((r['group_id'], r['item_id']), None)))
    pairs += [(None, s) for s in ex2.values()]
    ad2 = [r for r in a2 if not r['item_id']]
    used = set()
    for r in (r for r in a1 if not r['item_id']):
        m = next((i for i, s in enumerate(ad2) if i not in used and same_add(r, s)), None)
        if m is None:
            pairs.append((r, None))
        else:
            used.add(m)
            pairs.append((r, ad2[m]))
    pairs += [(None, s) for i, s in enumerate(ad2) if i not in used]

    def desc(r, label):
        return f"{label}: {r['verdict']} - {(r['notes'] or r['evidence_quote'])[:90]}" if r else f"{label}: no row"

    out = []
    for x, y in pairs:
        if x and y and x['verdict'] == y['verdict']:
            b = dict(pick(x, y))
            n = x['notes'] if x['notes'] == y['notes'] else ' | '.join(dict.fromkeys(t for t in (x['notes'], y['notes']) if t))
            diffs = []
            for f in ('proposed_name', 'proposed_date'):
                if x[f] and y[f] and x[f].strip().lower() != y[f].strip().lower():
                    diffs.append(f"{f[9:]} A1 {x[f]} / A2 {y[f]}")
            if x['proposed_link'] and y['proposed_link'] and nl(x['proposed_link']) != nl(y['proposed_link']):
                diffs.append(f"link A1 {x['proposed_link']} / A2 {y['proposed_link']}")
            if diffs:
                n = (n + '; ' if n else '') + 'proposals differ: ' + '; '.join(diffs)
            b['notes'], b['agents_agree'] = n, 'yes'
        else:
            b = dict(x or y)
            b['notes'] = desc(x, 'A1') + ' / ' + desc(y, 'A2')
            b['verdict'], b['agents_agree'] = '', 'no'
        out.append({k: b.get(k, '') for k in KEYS + ['agents_agree']})

    json.dump(out, open(os.path.join(W, 'final.json'), 'w'), indent=1)
    print(len(out), 'rows', dict(Counter(r['verdict'] or '(blank)' for r in out)),
          dict(Counter(r['agents_agree'] for r in out)))
    for r in out:
        if r['agents_agree'] == 'no':
            print(r['group_id'], '|', r['item_id'] or 'ADD ' + r['proposed_name'], '::', r['notes'])
    adds = Counter(r['group_id'] for r in out if not r['item_id'] and r['item_type'] != 'group')
    print('groups with >5 add rows:', {g: n for g, n in adds.items() if n > 5})


if __name__ == '__main__':
    main()
