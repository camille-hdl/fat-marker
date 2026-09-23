# Input is a tree of places; arrows are carried by affordances and point at place names

Each variant is a tree: places contain affordances (and nested places), and an affordance that leads somewhere carries `to`, the name of the target place. Names are unique within a variant and double as references; an unknown `to` is rejected with the list of the variant's place names. This shape makes the sketch's two rules unbreakable by construction (every affordance belongs to one place; every arrow starts from an affordance and ends in a place), and its `place` / `affordance` keys are the prefixes of the `fat-marker-sketch` skill's step 2, so an agent turns its list into JSON without inventing anything.

## Consequences

- Place names must be short: they are drawn as headings and retyped in every `to`. Renaming a place means updating the `to` that cite it.

## Considered Options

- **Tree with `id`s and a separate `arrows: [{ from, to }]` list**: stable ids make renames free, but an arrow from a place, or to an affordance, becomes expressible and must be rejected.
- **Flat lists à la Ryan Singer's breadboarding tables** (`P1`, `U1`, `in`, `place`): close to the skill's flat text, but containment can be inconsistent (unknown parent, cycles) and arrows to affordances are expressible.
