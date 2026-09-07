ALTER TABLE todos ADD COLUMN remind_at TIMESTAMPTZ;

CREATE INDEX todos_pending_remind_at_idx ON todos(account_id, remind_at, id)
    WHERE status = 'pending' AND remind_at IS NOT NULL;
