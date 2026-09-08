-- Keep legacy weak connection tests ineligible for a new publication.
ALTER TABLE model_config_tests ADD COLUMN validation_version TEXT;
ALTER TABLE model_config_versions ADD COLUMN rollback_source_version_id UUID REFERENCES model_config_versions(id);
ALTER TABLE model_config_versions ADD COLUMN key_source TEXT CHECK (key_source IN ('current','historical'));

-- A claim, business object, audit and response commit together. Never store a device token.
CREATE TABLE admin_idempotency_keys (
    admin_user_id UUID NOT NULL REFERENCES admin_users(id),
    action TEXT NOT NULL CHECK (action IN ('account.create','device.issue')),
    key UUID NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(admin_user_id,action,key)
);
CREATE INDEX accounts_admin_page ON accounts(created_at DESC,id DESC);
CREATE INDEX devices_admin_page ON devices(created_at DESC,id DESC);
CREATE INDEX agent_runs_admin_page ON agent_runs(created_at DESC,id DESC);
CREATE INDEX agent_runs_admin_account_page ON agent_runs(account_id,created_at DESC,id DESC);
CREATE INDEX todos_admin_page ON todos(created_at DESC,id DESC);
CREATE INDEX agent_events_admin_run ON agent_events(run_id,type,created_at);
