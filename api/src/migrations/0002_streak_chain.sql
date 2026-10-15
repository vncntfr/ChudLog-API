-- 0002 — streak chain bookkeeping for the idempotent rebuild.
-- streak_last_date: the accountability date (WIB) of the last REAL lit day in
-- the user's live streak chain, or NULL when the chain is dead. The rebuild
-- seeds from (current_streak, streak_last_date) and continues the chain only
-- when the window starts exactly on the next day — this is what makes
-- overlapping rebuilds converge.

ALTER TABLE rank_state ADD COLUMN streak_last_date TEXT;
