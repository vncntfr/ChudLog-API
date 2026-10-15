-- Request replay receipts are private, user-scoped, and checked inside the write transaction.
CREATE TABLE mutation_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, key)
);
-- A meal container created on time cannot make rows added later count as on-time.
ALTER TABLE meal_rows ADD COLUMN submitted_at INTEGER;
UPDATE meal_rows SET submitted_at = (SELECT submitted_at FROM meals WHERE meals.id = meal_rows.meal_id);
-- A REST logged before midnight cannot backdate a later replacement workout's points.
ALTER TABLE workouts ADD COLUMN qualified_at INTEGER;
UPDATE workouts SET qualified_at = submitted_at WHERE kind = 'workout' AND EXISTS
  (SELECT 1 FROM exercise_sets WHERE workout_id = workouts.id AND is_working = 1 AND reps >= 1);
CREATE INDEX meals_user_date ON meals(user_id,date);
CREATE INDEX receipts_created ON mutation_receipts(created_at);
CREATE TABLE import_payloads (
  job_id TEXT PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  UNIQUE(fingerprint, job_id)
);
