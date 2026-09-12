# Equipment catalog

The catalog contains 192 individually described items, 24 in each category:

| Category | File | Equipment slot |
| --- | --- | --- |
| Maces, clubs and hammers | `weapons/MACES.toml` | Weapon |
| Swords | `weapons/SWORDS.toml` | Weapon |
| Axes | `weapons/AXES.toml` | Weapon |
| Body armor | `armor/BODY_ARMOR.toml` | Armor |
| Helmets | `armor/HELMETS.toml` | Helmet |
| Gloves | `armor/GLOVES.toml` | Gloves |
| Rings | `accessories/RINGS.toml` | Ring 1 or Ring 2 |
| Amulets | `accessories/AMULETS.toml` | Amulet |

Files are explicitly registered in `content/catalog.toml`. Each has
`schema_version = 1`, a category and kind, shared `generation` instructions,
and `[[items]]` entries with stable ID, name, tier (1–3), rarity, sell value,
short description, individual visual description, base `stats`, and `modifiers`.
Appearance prose describes the physical object; the generation table controls
the transparent 64×64 icon, pixel style and framing. A glove pair is one item.

Weapons have `damage_min`/`damage_max`; body armor, helmets and gloves have
`armor`. Jewelry has an empty base-stats table and supplies modifiers. Health is
a separate modifier, not an automatic benefit of armor. Values are provisional
balance data, with separate early-road, forge and winter equipment at each tier.

| Modifier | Unit |
| --- | --- |
| `health` | Additional maximum HP |
| `damage` | Flat addition to both weapon damage endpoints, before pushup scaling |
| `armor` | Additional armor rating |
| `pushup_damage_coefficient` | Addition to damage coefficient per pushup (`0.01` means +1 percentage point per pushup) |
| `crit_chance_bps` | Critical chance; 100 basis points = 1 percentage point |
| `crit_damage_bps` | Addition to critical damage multiplier; 1000 = +10 percentage points |

Validate all content with `uv run content`. Export runtime data and individual
generation prompts with:

```sh
uv run python scripts/item_catalog.py --export src/game/catalog/items.json --prompts image-generation/items/v1/prompts.json
uv run python scripts/item_catalog.py --export src/game/catalog/items.json --prompts image-generation/items/v1/prompts.json --check
uv run python -m unittest discover -s scripts -p 'test_item_catalog.py'
```

Runtime JSON is generated from these TOML definitions. Earned items and pending
loot retain their own snapshots so future catalog changes cannot reroll them.
Icon generation and export provenance lives under `image-generation/items/v1`;
the final icons are bundled under `assets/items` with the same stable IDs.

## Combat and loot rules

Armor reduction is `min(0.75, armor / (100 + armor))`. A positive incoming hit
deals `max(1, round(rawDamage * (1 - reduction)))`; a dodge deals zero.
For example, 25 armor reduces damage by 20%, 100 by 50%, and 300 reaches the
75% cap. Armor and all modifiers add across equipped slots. Bag items contribute
nothing. Flat damage is added before the existing pushup multiplier.

Critical chance starts at zero and adds up to 100%. Critical damage starts at
150% of the trained hit and adds up to 500%. These combine into one critical
roll per attack, rather than independently multiplying one another. Existing
special attack effects remain supported; the strongest triggered critical wins.

An ordinary enemy has a 35% item-drop chance. Successful drops use common,
uncommon and rare weights of 60%, 30% and 10%. Bosses guarantee rare gear.
Chapter 1 uses tier 1, chapter 2 uses tier 2, and chapter 3 uses tier 3.
Uncommon drops add one rolled affix, rare drops add two distinct rolled affixes;
these can reinforce a definition's intrinsic modifiers. Affixes use their own
seeded loot stream and are saved in the item snapshot, including their names.

Inventory conversion to version 2 adds armor to known legacy protective gear
while preserving earned health, weapon rolls, sale prices and other bonuses.
It never regifts sold starters or rewrites active battle snapshots. The health
on old armor stays as a separate legacy bonus; newly authored armor uses its
explicit armor rating plus any listed modifiers. New stats take effect on the
next expedition.
