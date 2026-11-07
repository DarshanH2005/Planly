-- 00000000000010_canonical_executions.sql
-- Sprint B10: Verified Python execution and artifact-bound feedback
-- Authority: planly_architecture.md sections 9, 12; B10_python_execution.md
--
-- Establishes canonical executions table in planly schema for:
-- - Immutable binding to artifact hash and test suite hash
-- - Bounded execution evidence (passed, timed_out, failed, error, static_review_only)
-- - Test case outcomes, duration, stdout cap, and stale result flags

CREATE TABLE IF NOT EXISTS planly.executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    artifact_id UUID,
    artifact_revision INT NOT NULL,
    artifact_hash TEXT NOT NULL,
    test_suite_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'passed', 'failed', 'timed_out', 'error', 'static_review_only'
    )),
    passed BOOLEAN NOT NULL,
    tests_total INT NOT NULL DEFAULT 0,
    tests_passed INT NOT NULL DEFAULT 0,
    results JSONB NOT NULL DEFAULT '[]'::jsonb,
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    stdout_truncated BOOLEAN NOT NULL DEFAULT false,
    duration_ms NUMERIC NOT NULL DEFAULT 0.0,
    sandbox_provider TEXT NOT NULL DEFAULT 'subprocess',
    is_stale BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_executions_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_executions_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_executions_session_created
    ON planly.executions (owner_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executions_artifact_rev
    ON planly.executions (owner_id, artifact_id, artifact_revision);

ALTER TABLE planly.executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_executions_policy ON planly.executions
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
