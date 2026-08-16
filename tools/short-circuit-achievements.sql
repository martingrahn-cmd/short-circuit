-- ============================================================
-- Short Circuit: game row + 31 achievement definitions (English)
-- 15 bronze, 10 silver, 5 gold, 1 platinum (unlock-all-others).
-- Run in Supabase SQL Editor at GameVolt release time.
-- IDs match GameVolt.achievements.unlock(trophyId) -> 'short-circuit-<id>'.
-- Idempotent: safe to re-run.
--
-- Leaderboard modes (rows land in scores via the SDK):
--   'daily-streak' — daily-lock streak in days, higher is better
-- ============================================================

-- Game row (required — scores/achievements FK to games.id)
INSERT INTO games (id, title, thumbnail_url) VALUES
  ('short-circuit', 'Short Circuit', '/short-circuit/og-image.png')
ON CONFLICT (id) DO NOTHING;

-- Achievement definitions
DELETE FROM achievement_defs WHERE game_id = 'short-circuit';

INSERT INTO achievement_defs (id, game_id, title, description, icon, tier, sort_order) VALUES
  -- bronze (15)
  ('short-circuit-first-spark',    'short-circuit', 'First Spark',         'Close your first circuit',            '⚡', 'bronze',   1),
  ('short-circuit-three-open',     'short-circuit', 'Three Open',          'Open three campaign locks',           '🔓', 'bronze',   2),
  ('short-circuit-six-open',       'short-circuit', 'Six Open',            'Open six campaign locks',             '🗝️', 'bronze',   3),
  ('short-circuit-day-one',        'short-circuit', 'Day One',             'Solve a daily lock',                  '📅', 'bronze',   4),
  ('short-circuit-three-days',     'short-circuit', 'Three Days Live',     'Reach a 3-day daily streak',          '🔥', 'bronze',   5),
  ('short-circuit-podium',         'short-circuit', 'On the Podium',       'Earn any medal time',                 '🎖️', 'bronze',   6),
  ('short-circuit-medal-drawer',   'short-circuit', 'Medal Drawer',        'Earn five medal times',               '🥉', 'bronze',   7),
  ('short-circuit-busy-fingers',   'short-circuit', 'Busy Fingers',        'Press 100 conductors',                '👆', 'bronze',   8),
  ('short-circuit-switchboard',    'short-circuit', 'Switchboard',         'Bank 50 swaps',                       '🔀', 'bronze',   9),
  ('short-circuit-through-gold',   'short-circuit', 'Routed Through Gold', 'Beat a lock with welded conductors',  '🔩', 'bronze',  10),
  ('short-circuit-big-board',      'short-circuit', 'The Big Board',       'Solve a 6×6 circuit',                 '🗄️', 'bronze',  11),
  ('short-circuit-worn-open',      'short-circuit', 'Worn But Open',       'Win a lock after a restart',          '🔧', 'bronze',  12),
  ('short-circuit-hands-on-keys',  'short-circuit', 'Hands on Keys',       'Solve a lock on the keyboard',        '⌨️', 'bronze',  13),
  ('short-circuit-schooled',       'short-circuit', 'Schooled',            'Finish the teaching circuit',         '🎓', 'bronze',  14),
  ('short-circuit-shift-worker',   'short-circuit', 'Shift Worker',        '15 minutes in the box',               '⏱️', 'bronze',  15),
  -- silver (10)
  ('short-circuit-halfway-in',     'short-circuit', 'Halfway In',          'Open twelve campaign locks',          '🚪', 'silver',  16),
  ('short-circuit-deep-panels',    'short-circuit', 'Deep Panels',         'Open eighteen campaign locks',        '🕳️', 'silver',  17),
  ('short-circuit-week-live',      'short-circuit', 'One Week Live',       'Reach a 7-day daily streak',          '📆', 'silver',  18),
  ('short-circuit-golden-touch',   'short-circuit', 'Golden Touch',        'Earn a gold medal time',              '🥇', 'silver',  19),
  ('short-circuit-shinework',      'short-circuit', 'Shinework',           'Five silver-or-better medals',        '✨', 'silver',  20),
  ('short-circuit-ten-flat',       'short-circuit', 'Ten Flat',            'Solve a lock in under 10 seconds',    '⚡', 'silver',  21),
  ('short-circuit-first-blood',    'short-circuit', 'First Blood',         'Win a live duel',                     '⚔️', 'silver',  22),
  ('short-circuit-trigger-finger', 'short-circuit', 'Trigger Finger',      'Slam the breaker 25 times',           '🔴', 'silver',  23),
  ('short-circuit-regular',        'short-circuit', 'Regular',             'Solve ten daily locks',               '🌅', 'silver',  24),
  ('short-circuit-long-shift',     'short-circuit', 'The Long Shift',      'An hour in the box',                  '🕐', 'silver',  25),
  -- gold (5)
  ('short-circuit-all-panels',     'short-circuit', 'All Panels Open',     'Clear all 24 campaign locks',         '🏆', 'gold',    26),
  ('short-circuit-gilded-dozen',   'short-circuit', 'Gilded Dozen',        'Twelve gold medal times',             '👑', 'gold',    27),
  ('short-circuit-month-live',     'short-circuit', 'A Month Live',        'Reach a 30-day daily streak',         '🌟', 'gold',    28),
  ('short-circuit-duelist',        'short-circuit', 'Duelist',             'Win ten live duels',                  '🤺', 'gold',    29),
  ('short-circuit-five-flat',      'short-circuit', 'Five Flat',           'Solve a lock in under 5 seconds',     '💨', 'gold',    30),
  -- platinum (1)
  ('short-circuit-master',         'short-circuit', 'Master Electrician',  'Unlock every other trophy',           '💎', 'platinum', 31);
