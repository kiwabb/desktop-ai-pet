CREATE TABLE accounts (
    id UUID PRIMARY KEY, name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE devices (
    id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    roles TEXT[] NOT NULL CHECK (roles <@ ARRAY['control','node']::TEXT[]),
    revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_account ON devices(account_id);
CREATE TABLE tool_definitions (
    name TEXT NOT NULL, version TEXT NOT NULL, description TEXT NOT NULL,
    input_schema JSONB NOT NULL, permission TEXT NOT NULL,
    execution_location TEXT NOT NULL CHECK (execution_location IN ('server','device')),
    PRIMARY KEY(name, version)
);
CREATE TABLE tool_instances (
    instance_id TEXT PRIMARY KEY, tool_name TEXT NOT NULL, tool_version TEXT NOT NULL,
    account_id UUID REFERENCES accounts(id), device_id UUID REFERENCES devices(id),
    handler_key TEXT,
    FOREIGN KEY(tool_name,tool_version) REFERENCES tool_definitions(name,version),
    CHECK ((device_id IS NULL AND account_id IS NULL AND handler_key IS NOT NULL)
        OR (device_id IS NOT NULL AND account_id IS NOT NULL AND handler_key IS NULL))
);
