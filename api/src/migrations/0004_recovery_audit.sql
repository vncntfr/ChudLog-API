CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX reset_user ON password_resets(user_id);
CREATE TRIGGER log_events_no_update BEFORE UPDATE ON log_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
CREATE TRIGGER log_events_no_delete BEFORE DELETE ON log_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
CREATE TRIGGER restores_no_update BEFORE UPDATE ON restores BEGIN SELECT RAISE(ABORT,'restore events are immutable'); END;
CREATE TRIGGER restores_no_delete BEFORE DELETE ON restores BEGIN SELECT RAISE(ABORT,'restore events are immutable'); END;
