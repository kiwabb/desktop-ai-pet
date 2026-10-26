CREATE TABLE memos (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL CHECK (kind IN ('note', 'goal')),
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 2000),
    content TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    review_at TIMESTAMPTZ,
    -- Nullable: direct REST/command creation has no tool call (008 lesson).
    source_tool_call_id UUID UNIQUE REFERENCES agent_tool_calls(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX memos_account ON memos(account_id, created_at, id);
CREATE INDEX memos_active_review_at ON memos(account_id, review_at, id)
    WHERE status = 'active' AND review_at IS NOT NULL;
