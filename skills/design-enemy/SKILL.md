---
name: design-enemy
description: Collaboratively design enemies for an existing biome in this repository. Use for biome-specific enemy suggestions, custom creature concepts, appearance and attack review, and adding accepted designs to the biome's TOML roster.
---

# Design Enemy

Design one enemy at a time with the user: biome, suggestions or custom concept,
selection, appearance and attack descriptions, acceptance, then TOML insertion.
Resume the current conversation stage rather than restarting the workflow.

## Establish the biome

Accept a biome display name or stable ID, for example `$design-enemy Wetlands`.
Use an unambiguous biome already established in the conversation if the input
omits it. Otherwise ask which biome the user means. If the biome is unknown,
show the available biomes and resolve the target before designing an enemy;
do not create a biome as a side effect.

Read these sources before proposing or drafting:

- [Design guidelines](../../content/design_guidelines.toml) for tone and visual-description conventions.
- [Content contract](../../content/README.md) for the current TOML schema and ownership rules.
- [Catalog](../../content/catalog.toml) to resolve the selected biome's actual file paths.
- The selected `BIOME.toml` and `ENEMIES.toml` for habitat, local constraints, and existing enemies.

Resolve catalog paths from the repository's `content/` directory. Existing enemy
definitions are useful format references; their distinctive anatomy, eye design,
or equipment are not defaults for unrelated creatures.

## Suggest and select

Offer a short, numbered set of distinct candidates, usually three to five. Give
each a working name and a concise description that conveys its appearance and
fit with the biome. Respect the current roster and the biome's specific ecology,
inhabitants, and mood. Keep the dark fantasy and understated humor grounded in
physical traits and behavior.

The user may choose a candidate, request more suggestions, refine the options,
or propose a custom enemy. For more suggestions, provide fresh alternatives
that incorporate their feedback. A supplied custom concept can go directly to
the description stage. Choosing a concept authorizes drafting its description;
it does not approve adding it to the roster.

Do not add enemy definitions, encounter entries, or draft catalog content during
brainstorming or description review.

## Describe and review

Present the chosen enemy's working name, rich appearance prose, and a separate
short **Attack** paragraph in the conversation. Roughly two substantive
paragraphs are a useful starting point for appearance; detail and clarity matter
more than a fixed word count. The appearance prose will become the enemy's
top-level `visual_description`.

Describe the creature itself in third-person present tense: scale, body shape,
anatomy, face and eyes, skin or other surface material, colors, textures,
clothing and equipment when applicable, wear, stance, and distinguishing
details. Convey restrained humor through its appearance or natural behavior.
Keep artist directions, camera framing, sprite specifications, and animation
instructions out of this prose. Avoid inventing combat abilities or extensive
lore to fill out a visual description.

The **Attack** paragraph describes how the enemy attacks in third-person present
tense: what it uses (such as teeth, nails, a weapon, or magic fitting the concept),
how it prepares and moves into the strike, and its follow-through or recovery.
Make the action concrete enough to picture and animate, consistent with its
anatomy, equipment, and the user's choices. Keep this paragraph descriptive,
without directions to an artist, camera specifications, or invented numeric
damage and status-effect rules. It will become `visual.attack`.

For example: "She reaches forward with one long arm and hooks her fingers,
raking her target with her long nails. Her shoulder turns with the swipe before
her hand drops back to her side."

Review appearance and attack together as one draft. Invite the user to accept,
request changes, or reject it, then wait for their response before saving.
Revisions remain in review until accepted. If they reject the concept, return
to suggestions or follow their replacement idea. Do not interpret silence as
acceptance.

An explicit acceptance of the latest draft authorizes saving it. Honor
approval already given in the conversation without asking again. Acceptance
with a concrete correction, such as "Yes, add it, but make its eyes black with
small white strips," authorizes saving the accepted description with that
correction. Feedback that only asks for a change calls for a revised draft.

## Save the accepted enemy

Read the target roster again before editing so intervening changes are retained.
Use the current schema in `content/README.md`; do not duplicate or redesign that
schema inside this skill.

1. Choose a stable `snake_case` enemy ID and check existing canonical definitions
   across the registered catalog for collisions. Reuse an existing definition
   when adding that same enemy to another biome. Do not duplicate an entry or
   encounter on a repeated save request; an intentional variant needs its own ID.
2. Append one `[[enemies]]` definition to the selected biome's `ENEMIES.toml` for
   a new enemy. Store the accepted prose in top-level `visual_description`,
   preserving its wording apart from the user's accepted corrections. Supply a
   shorter bestiary `description` and a restrained `quirk` consistent with it.
3. Fill the required classification, stats, fallback sprite, and structured
   `visual` fields. When the user has not specified balance, use reasonable
   provisional values and `balance = "draft"`; do not hold up an accepted design
   for a separate balancing discussion. Store the accepted **Attack** paragraph
   in `visual.attack`, preserving its wording apart from accepted corrections.
   Derive the remaining visual fields and idle behavior from the accepted
   creature without introducing unreviewed anatomy, equipment, or abilities.
   Keep eyes, palette, appearance, attack, and avoid-fields consistent.
4. Add one `[[encounters]]` reference containing only `enemy_id` in the target
   roster, preserving earlier entries and their order. Enemies spawn randomly
   as the player walks through the side-scrolling biome; do not add `context`
   or require particular pools, buildings, props, or locations for spawning.
   Remove an empty `enemies = []`
   or `encounters = []` declaration when replacing it with array-of-table entries;
   retain the file's root `schema_version` and `biome_id`.
5. Update existing roster summaries only where this addition makes them
   inaccurate. Keep other biomes, unselected candidates, and runtime integration
   outside the change.

## Validate and report

Use the repository's existing content tool with an available Python 3.11+
interpreter. Run from the repository root, replacing the biome ID and output
path for the selected biome:

```bash
python3.12 -B scripts/content.py --biome wetlands --export-json /tmp/wetlands-content.json
```

The command validates the full catalog and exports the selected biome. Inspect
the parsed roster and resolved JSON to confirm the new ID appears once, its
encounter resolves to the full definition, and `enemy.visual_description` and
`enemy.visual.attack` contain the accepted appearance and attack text with any
corrections. Repair validation failures in the current change before reporting
success; preserve unrelated content.

Finish with the enemy's name, a link to its `ENEMIES.toml`, and the validation
result. Mention provisional combat values when newly supplied. The user chooses
whether to begin another enemy.
