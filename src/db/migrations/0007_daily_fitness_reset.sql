-- Retire snapshots made with lifetime pushup power and midnight step totals.
-- Banked rewards, health, equipment, workout records, and past results stay intact.
UPDATE dungeon_runs
SET status = 'expired', state = json_set(state,
  '$.status', 'expired', '$.gold', 0, '$.xp', 0, '$.loot', json_array(),
  '$.log', json_array('Daily bonuses now reset at 5 AM device time. Start a fresh expedition with today’s training.'))
WHERE status = 'active';
--> statement-breakpoint
-- GPS runs have a completion timestamp; manual entries retain their chosen date.
UPDATE runs
SET day = date(created_at / 1000, 'unixepoch', 'localtime', '-5 hours')
WHERE source = 'gps';
