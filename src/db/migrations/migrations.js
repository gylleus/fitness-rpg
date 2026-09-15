// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_last_sinister_six.sql';
import m0001 from './0001_fitness_game.sql';
import m0002 from './0002_native_activity_and_expeditions.sql';
import m0003 from './0003_attack_stockpile.sql';
import m0004 from './0004_dungeon_recovery.sql';
import m0005 from './0005_pushup_damage.sql';
import m0006 from './0006_inventory.sql';
import m0007 from './0007_daily_fitness_reset.sql';
import m0008 from './0008_camp_expeditions.sql';
import m0009 from './0009_dev_travel_steps.sql';

export default {
  journal,
  migrations: {
    m0000, m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009,
  },
};
