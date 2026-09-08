CREATE TABLE admin_users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'observer')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
    id UUID PRIMARY KEY,
    admin_user_id UUID NOT NULL REFERENCES admin_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_active ON admin_sessions(token_hash, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE admin_audit_events (
    id UUID PRIMARY KEY,
    admin_user_id UUID REFERENCES admin_users(id),
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
    request_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit_events(created_at DESC, id DESC);

CREATE TABLE model_secret_versions (
    id UUID PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    key_id TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_config_versions (
    id UUID PRIMARY KEY,
    parent_version_id UUID REFERENCES model_config_versions(id),
    base_url TEXT NOT NULL,
    model_name TEXT NOT NULL,
    timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 5 AND 600),
    secret_version_id UUID REFERENCES model_secret_versions(id),
    created_by UUID NOT NULL REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX model_config_versions_created ON model_config_versions(created_at DESC, id DESC);

CREATE TABLE model_config_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    active_version_id UUID REFERENCES model_config_versions(id),
    revision BIGINT NOT NULL DEFAULT 0,
    management_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO model_config_state(singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE model_config_tests (
    id UUID PRIMARY KEY,
    version_id UUID NOT NULL REFERENCES model_config_versions(id),
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    error_message TEXT,
    tested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX model_config_tests_version ON model_config_tests(version_id, tested_at DESC);

CREATE TABLE model_config_publications (
    id UUID PRIMARY KEY,
    from_version_id UUID REFERENCES model_config_versions(id),
    to_version_id UUID NOT NULL REFERENCES model_config_versions(id),
    kind TEXT NOT NULL CHECK (kind IN ('publish', 'rollback')),
    expected_revision BIGINT NOT NULL,
    resulting_revision BIGINT NOT NULL,
    created_by UUID NOT NULL REFERENCES admin_users(id),
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX model_config_publications_created ON model_config_publications(created_at DESC, id DESC);

ALTER TABLE agent_runs ADD COLUMN model_config_version_id UUID REFERENCES model_config_versions(id);

CREATE TABLE run_trace_states (
    run_id UUID PRIMARY KEY REFERENCES agent_runs(id),
    session_id UUID NOT NULL REFERENCES agent_sessions(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    collection_version TEXT NOT NULL DEFAULT '1',
    expected_steps INTEGER,
    collected_steps INTEGER NOT NULL DEFAULT 0,
    integrity TEXT NOT NULL DEFAULT 'partial' CHECK (integrity IN ('partial', 'complete', 'incomplete', 'legacy')),
    gap_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_call_traces (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES agent_runs(id),
    step_index INTEGER NOT NULL,
    config_version_id UUID REFERENCES model_config_versions(id),
    model_name TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT,
    first_response_at TIMESTAMPTZ,
    first_visible_text_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    error_type TEXT,
    error_status INTEGER,
    provider_request_id TEXT,
    usage JSONB,
    usage_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(run_id, step_index)
);
CREATE INDEX model_call_traces_run ON model_call_traces(run_id, step_index);

CREATE TABLE trace_payloads (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES agent_runs(id),
    model_call_id UUID NOT NULL REFERENCES model_call_traces(id),
    kind TEXT NOT NULL CHECK (kind IN ('application_request', 'model_response')),
    body JSONB NOT NULL,
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    original_bytes INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trace_payloads_expiry ON trace_payloads(expires_at);

CREATE TABLE tool_trace_links (
    model_call_id UUID NOT NULL REFERENCES model_call_traces(id),
    tool_call_id UUID NOT NULL REFERENCES agent_tool_calls(id),
    step_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(model_call_id, tool_call_id)
);
