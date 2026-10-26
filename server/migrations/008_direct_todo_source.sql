-- Directly created todos have no agent tool call. Keep their source NULL,
-- retaining the existing UNIQUE and foreign key for real tool-created todos.
ALTER TABLE todos ALTER COLUMN source_tool_call_id DROP NOT NULL;
