CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    seq BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_sessions_account ON agent_sessions(account_id);

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY,
    ordinal BIGSERIAL UNIQUE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    session_id UUID NOT NULL REFERENCES agent_sessions(id),
    request_id UUID NOT NULL,
    input_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','interrupted')),
    error TEXT,
    lease_owner UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(account_id, request_id)
);
CREATE INDEX agent_runs_queue ON agent_runs(status, ordinal);
CREATE UNIQUE INDEX agent_one_running_per_session ON agent_runs(session_id) WHERE status = 'running';

CREATE TABLE agent_messages (
    id UUID PRIMARY KEY,
    ordinal BIGSERIAL UNIQUE,
    session_id UUID NOT NULL REFERENCES agent_sessions(id),
    run_id UUID NOT NULL REFERENCES agent_runs(id),
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(run_id, role)
);
CREATE INDEX agent_messages_session ON agent_messages(session_id, ordinal);

CREATE TABLE agent_tool_calls (
    id UUID PRIMARY KEY,
    ordinal BIGSERIAL UNIQUE,
    run_id UUID NOT NULL REFERENCES agent_runs(id),
    model_call_id TEXT NOT NULL,
    name TEXT NOT NULL,
    arguments JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','needs_reconciliation')),
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(run_id, model_call_id)
);

CREATE TABLE todos (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
    source_tool_call_id UUID NOT NULL UNIQUE REFERENCES agent_tool_calls(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX todos_account ON todos(account_id, created_at, id);

CREATE TABLE agent_events (
    session_id UUID NOT NULL REFERENCES agent_sessions(id),
    seq BIGINT NOT NULL,
    run_id UUID NOT NULL REFERENCES agent_runs(id),
    type TEXT NOT NULL,
    envelope JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id, seq)
);
