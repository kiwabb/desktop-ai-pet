ALTER TABLE model_call_traces
    ADD COLUMN first_token_ms BIGINT CHECK (first_token_ms >= 0),
    ADD COLUMN first_visible_text_ms BIGINT CHECK (first_visible_text_ms >= 0);
ALTER TABLE model_call_traces DROP CONSTRAINT model_call_traces_status_check;
ALTER TABLE model_call_traces ADD CONSTRAINT model_call_traces_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted'));
-- A stable output payload is updated while streaming, then sealed at termination.
CREATE UNIQUE INDEX trace_payloads_call_kind ON trace_payloads(model_call_id, kind);

-- Recovery grace uses durable terminal events, including historical runs.
CREATE INDEX agent_events_trace_terminal ON agent_events(run_id, created_at)
    WHERE type IN ('run.completed', 'run.failed', 'run.interrupted');
