ALTER TABLE `dungeon_runs` ADD `dismissed_at` integer;
--> statement-breakpoint
-- Before per-attempt spending was recorded, failed attempts kept their costs.
-- If every paid attempt is an old failure, the entire remaining spend can be
-- refunded exactly, including discounts. Do not guess costs for mixed saves
-- containing paid victories, active attempts, or newer refund accounting.
UPDATE heroes SET pushup_units_spent = 0
WHERE id = 1 AND pushup_units_spent > 0
  AND EXISTS (
    SELECT 1 FROM dungeon_runs
    WHERE status IN ('defeat', 'exhausted', 'retreated', 'expired')
      AND json_extract(state, '$.attacksMade') > 0
      AND json_extract(state, '$.pushupUnitsSpent') IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM dungeon_runs
    WHERE status = 'active'
      OR json_extract(state, '$.pushupUnitsSpent') IS NOT NULL
      OR (status NOT IN ('defeat', 'exhausted', 'retreated', 'expired')
        AND json_extract(state, '$.attacksMade') > 0)
  );
