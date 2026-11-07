-- 00000000000006_canonical_runs_jobs.sql
-- Sprint B04: Durable jobs, run receipts and reconnectable events
--
-- Establishes canonical tables in planly schema for:
-- - turn_runs: Request deduplication, foreground/background lanes, leasing, fencing
-- - run_events: Monotonically sequenced, reconnectable event stream
-- - jobs: Short-transaction worker queue with bounded lanes
-- - external_call_receipts: Exactly-once external billing/model receipts with uncertain handling
-- - mutation_receipts: Revision-bound state mutation deduplication

-- 1. Turn Runs
CREATE TABLE IF NOT EXISTS planly.turn_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL,
    session_id UUID NOT NULL,
    message_id UUID,
    client_request_id TEXT NOT NULL,
    expected_revision INT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    lane TEXT NOT NULL DEFAULT 'foreground' CHECK (lane IN ('foreground', 'background')),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    fence INT NOT NULL DEFAULT 1,
    decision_json JSONB,
    error_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_turn_runs_classroom FOREIGN KEY (owner_id, classroom_id)
        REFERENCES planly.classrooms(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_turn_runs_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_turn_runs_owner_id UNIQUE (owner_id, id),
    CONSTRAINT uq_turn_runs_owner_request UNIQUE (owner_id, client_request_id)
);

-- B04-AC1: Enforce at DB level that there is at most one active foreground run per classroom
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_foreground_run_per_classroom
    ON planly.turn_runs (classroom_id)
    WHERE (lane = 'foreground' AND state IN ('queued', 'running'));

-- 2. Run Events (reconnectable event sequence)
CREATE TABLE IF NOT EXISTS planly.run_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    seq INT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('queued', 'thinking', 'decision', 'chunk', 'done', 'error', 'cancelled')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_run_events_run FOREIGN KEY (owner_id, run_id)
        REFERENCES planly.turn_runs(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_run_events_seq UNIQUE (run_id, seq),
    CONSTRAINT uq_run_events_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_run_events_resume
    ON planly.run_events (run_id, seq);

-- 3. Jobs Queue (short transaction claims, leasing & fencing)
CREATE TABLE IF NOT EXISTS planly.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_id UUID,
    job_type TEXT NOT NULL,
    lane TEXT NOT NULL DEFAULT 'background' CHECK (lane IN ('foreground', 'background')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    fence INT NOT NULL DEFAULT 1,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_jobs_run FOREIGN KEY (owner_id, run_id)
        REFERENCES planly.turn_runs(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_jobs_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_claimable
    ON planly.jobs (lane, status, lease_expires_at);

-- 4. External Call Receipts (B04: exactly-once external billing/model receipts with uncertain status)
CREATE TABLE IF NOT EXISTS planly.external_call_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_id UUID,
    idempotency_key TEXT NOT NULL,
    call_type TEXT NOT NULL CHECK (call_type IN ('model_inference', 'sandbox_run', 'billing')),
    status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'uncertain')),
    request_hash TEXT NOT NULL,
    response_json JSONB,
    cost_cents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_external_receipt_owner_key UNIQUE (owner_id, idempotency_key),
    CONSTRAINT uq_external_call_receipts_owner_id UNIQUE (owner_id, id)
);

-- 5. Mutation Receipts (idempotent applied mutations)
CREATE TABLE IF NOT EXISTS planly.mutation_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    mutation_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    applied_revision INT NOT NULL,
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_mutation_receipt UNIQUE (owner_id, idempotency_key),
    CONSTRAINT uq_mutation_receipts_owner_id UNIQUE (owner_id, id)
);

-- 6. Row Level Security
ALTER TABLE planly.turn_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.external_call_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.mutation_receipts ENABLE ROW LEVEL SECURITY;

-- Owner isolation policies
CREATE POLICY owner_turn_runs ON planly.turn_runs FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_run_events ON planly.run_events FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_jobs ON planly.jobs FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_external_call_receipts ON planly.external_call_receipts FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_mutation_receipts ON planly.mutation_receipts FOR ALL USING (auth.uid() = owner_id);

-- Service role full access for worker & API backend
CREATE POLICY service_role_turn_runs ON planly.turn_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_run_events ON planly.run_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_jobs ON planly.jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_external_call_receipts ON planly.external_call_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_mutation_receipts ON planly.mutation_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
