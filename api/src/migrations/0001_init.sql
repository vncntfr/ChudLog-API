-- ChudLog schema 0001 — full private v1 (revised handoff, 2026-10-13).
-- Plain SQLite 3, no dialect-specific syntax. Idempotent: IF NOT EXISTS
-- everywhere except meta bookkeeping handled by the runner.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- users ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                              -- crypto.randomUUID
  email TEXT NOT NULL UNIQUE,
  pass_salt BLOB NOT NULL,                          -- 16 bytes
  pass_hash BLOB NOT NULL,                          -- PBKDF2-SHA-256 70k (PRIVATE, temporary owner choice); public migrates to Argon2id
  hashing_algo TEXT NOT NULL DEFAULT 'pbkdf2-sha256-70k',
  display_name TEXT NOT NULL,                       -- identity, ≤24
  tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',          -- private: FIXED WIB; public: user IANA zone
  created_at INTEGER NOT NULL,                      -- unix ms UTC
  sex TEXT CHECK (sex IN ('m','f') OR sex IS NULL),
  age INTEGER CHECK (age BETWEEN 1 AND 120 OR age IS NULL),
  height_cm INTEGER CHECK (height_cm BETWEEN 90 AND 250 OR height_cm IS NULL),
  bodyweight_kg REAL CHECK (bodyweight_kg IS NULL OR (bodyweight_kg > 0 AND bodyweight_kg < 400)),
  activity_factor REAL NOT NULL DEFAULT 1.375 CHECK (activity_factor IN (1.2, 1.375, 1.55, 1.725, 1.9)),
  bar_weight_kg REAL NOT NULL DEFAULT 20,
  plates_kg TEXT,                                   -- JSON: [2.5, 10, 15]
  calorie_goal INTEGER,
  calorie_goal_mode TEXT CHECK (calorie_goal_mode IN ('maintain','mild','loss','extreme','custom') OR calorie_goal_mode IS NULL),
  protein_goal INTEGER
);

-- groups & membership ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                               -- ≤40
  calendar_tz TEXT NOT NULL DEFAULT 'Asia/Jakarta', -- private pinned group tz
  invite_code TEXT NOT NULL UNIQUE,                 -- 8 chars, high-entropy
  max_members INTEGER NOT NULL DEFAULT 10,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS gm_user ON group_members(user_id);

-- sleep -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sleep (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                               -- 'YYYY-MM-DD' wake day (WIB private)
  calendar_tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  submitted_at INTEGER NOT NULL,                    -- server UTC ms, authoritative timeliness
  bed_ts INTEGER NOT NULL,
  wake_ts INTEGER NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 60 AND 2880),
  color TEXT NOT NULL CHECK (color IN ('green','yellow','red')),
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS sleep_user_date ON sleep(user_id, date);

-- food --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                               -- WIB 'YYYY-MM-DD' private
  calendar_tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  submitted_at INTEGER NOT NULL,                    -- server UTC ms, not user backdate
  ts INTEGER NOT NULL,                              -- claimed eat time (user, editable)
  label TEXT,                                       -- ≤30
  UNIQUE (user_id, id)
);
CREATE TABLE IF NOT EXISTS meal_rows (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                               -- ≤60
  norm_name TEXT NOT NULL,
  amount TEXT NOT NULL,                             -- free text: '200 g'
  kcal REAL NOT NULL CHECK (kcal >= 0),             -- SNAPSHOT for the logged amount
  protein_g REAL NOT NULL CHECK (protein_g >= 0),   -- SNAPSHOT
  source_food_id TEXT,                              -- nullable provenance (saved food used)
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  micros TEXT                                       -- optional JSON
);
CREATE INDEX IF NOT EXISTS meal_rows_meal ON meal_rows(meal_id);

-- saved foods (personal) ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  default_amount TEXT NOT NULL,                     -- fixed serving, e.g. '200 g' | '1 bowl'
  kcal REAL NOT NULL CHECK (kcal >= 0),             -- kcal FOR default_amount (not per-100g)
  protein_g REAL NOT NULL CHECK (protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  micros TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, norm_name)
);

-- community food library (reserved in private; promotion is PUBLIC design) -------
CREATE TABLE IF NOT EXISTS community_foods (
  id TEXT PRIMARY KEY,
  norm_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kcal_min REAL, kcal_max REAL,
  protein_min REAL, protein_max REAL,
  users_agree INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- workouts (ONE daily gym outcome per user) ---------------------------------------
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                               -- WIB day at time of action
  calendar_tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  submitted_at INTEGER NOT NULL,                    -- server UTC ms
  started_ts INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout','rest')),
  rest_reason TEXT,                                 -- ≤50, group-visible
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 0 AND 720),
  notes TEXT,
  UNIQUE (user_id, date)                            -- REST can be replaced by workout, never double
);
CREATE INDEX IF NOT EXISTS workouts_user_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS exercise_sets (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise TEXT NOT NULL,
  muscle TEXT NOT NULL,
  set_no INTEGER NOT NULL CHECK (set_no >= 1),
  kg REAL CHECK (kg IS NULL OR kg >= 0),            -- NULL = bodyweight move
  reps INTEGER CHECK (reps IS NULL OR (reps BETWEEN 1 AND 60)),
  rir TEXT CHECK (rir IN ('0','1','2','3+') OR rir IS NULL),
  e1rm REAL,
  is_working INTEGER NOT NULL DEFAULT 1 CHECK (is_working IN (0,1))
);
CREATE INDEX IF NOT EXISTS sets_workout ON exercise_sets(workout_id);

-- routines (planning) ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekday','rotation')),
  weekday INTEGER CHECK ((kind='weekday' AND weekday BETWEEN 1 AND 7) OR (kind='rotation' AND weekday IS NULL)),
  sequence INTEGER CHECK (sequence IS NULL OR sequence >= 0),
  exercises TEXT NOT NULL                           -- JSON: [{exercise, muscle, sets, target_kg, target_reps}]
);

-- day_log = RECOMPUTABLE MATERIALIZED PROJECTION (never the audit trail) --------------
CREATE TABLE IF NOT EXISTS day_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                               -- WIB in private
  calendar_tz TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  food INTEGER NOT NULL DEFAULT 0,
  sleep INTEGER NOT NULL DEFAULT 0,
  gym INTEGER NOT NULL DEFAULT 0,                   -- 1 = workout OR explicit rest
  lit INTEGER NOT NULL DEFAULT 0,
  restore_used INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,         -- workout-only: 0 or 10/20/30/50
  UNIQUE (user_id, date)
);
CREATE INDEX IF NOT EXISTS day_log_user_date ON day_log(user_id, date);

-- rank state (rebuildable from day_log + log_events) -------------------------------------
CREATE TABLE IF NOT EXISTS rank_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak_date TEXT,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  lifetime_tier TEXT NOT NULL DEFAULT 'iron',
  season_id TEXT,
  season_points INTEGER NOT NULL DEFAULT 0,
  season_tier TEXT NOT NULL DEFAULT 'iron',
  restore_month TEXT,
  last_activity_ts INTEGER
);

-- server-authored append-only audit ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','rest-replace','import','restore','admin-correction')),
  occurred_at INTEGER NOT NULL,                     -- server UTC ms
  date TEXT NOT NULL,                               -- WIB accountability date
  idempotency_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS log_events_idem ON log_events(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS log_events_user_date ON log_events(user_id, date);

-- opaque revocable sessions (token stored ONLY as hash) -----------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- streak restore events (append-only) ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restores (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  used_ts INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- push ---------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- durable nudge jobs: ONE combined push per user per hour ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nudge_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,                         -- private WIB date
  local_hour INTEGER NOT NULL CHECK (local_hour BETWEEN 8 AND 23),
  due_trackers TEXT NOT NULL,                       -- JSON array ["sleep","gym","food"]
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','retry','dead')) DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at INTEGER,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (user_id, local_date, local_hour)
);

CREATE TABLE IF NOT EXISTS nudge_deliveries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  local_hour INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','retry','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  PRIMARY KEY (user_id, local_date, local_hour, endpoint)
);

-- settings (no in-app snooze in private) -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  morning_push INTEGER NOT NULL DEFAULT 1 CHECK (morning_push IN (0,1))
);

-- CSV imports --------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('hevy','strong')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','aborted')),
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
