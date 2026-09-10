-- Retire attempts whose snapshot used consumable attacks. Preserve all workout
-- records, banked progression, entry health, potion charges and old results.
-- Historical spending is retained for audit only; damage uses full saved reps.
UPDATE dungeon_runs SET status = 'retreated', state = json_set(state,
  '$.status', 'retreated', '$.gold', 0, '$.xp', 0,
  '$.log', json_array('Pushups now multiply damage and are never spent. Start a new expedition with your saved training.'))
WHERE status = 'active' AND coalesce(json_extract(state, '$.rulesVersion'), 0) < 2;
