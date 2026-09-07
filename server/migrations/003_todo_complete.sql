ALTER TABLE todos DROP CONSTRAINT todos_status_check;
ALTER TABLE todos ADD CONSTRAINT todos_status_check CHECK (status IN ('pending', 'completed'));
