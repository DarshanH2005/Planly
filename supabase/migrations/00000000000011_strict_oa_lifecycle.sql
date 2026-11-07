-- 00000000000011_strict_oa_lifecycle.sql
-- Sprint B18: Strict OA lifecycle and immutable resource policy
-- Authority: planly_architecture.md sections 8, 9, 12; B18_strict_oa.md
--
-- Establishes canonical assessment tracking in planly schema for:
-- - Server-persisted start and deadline timestamps immune to browser clock forgery
-- - Immutable resource policy (docs, ai, hints, notes)
-- - Pre-deadline draft tracking with optimistic concurrency
-- - Honest interruption and practice conversion tracking

-- 1. Extend planly.sessions with strict OA metadata
ALTER TABLE planly.sessions
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finish_reason TEXT,
    ADD COLUMN IF NOT EXISTS resource_policy JSONB NOT NULL DEFAULT '{"docs": false, "ai": false, "hints": false, "notes": false}'::jsonb,
    ADD COLUMN IF NOT EXISTS pack_id TEXT,
    ADD COLUMN IF NOT EXISTS pack_version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_interrupted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_assisted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS linked_prior_session_id UUID;

-- 2. Assessment Drafts
CREATE TABLE IF NOT EXISTS planly.assessment_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    prompt_id TEXT NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    code TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'python',
    notes TEXT NOT NULL DEFAULT '',
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_assessment_drafts_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_assessment_drafts_prompt UNIQUE (owner_id, session_id, prompt_id),
    CONSTRAINT uq_assessment_drafts_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_drafts_session
    ON planly.assessment_drafts (owner_id, session_id);

ALTER TABLE planly.assessment_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_assessment_drafts_policy ON planly.assessment_drafts
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 3. Assessment Events (Clarifications, Conversions, Interruptions)
CREATE TABLE IF NOT EXISTS planly.assessment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('clarification', 'conversion', 'interruption', 'timeout', 'finalize')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_assessment_events_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_assessment_events_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_events_session
    ON planly.assessment_events (owner_id, session_id, created_at ASC);

ALTER TABLE planly.assessment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_assessment_events_policy ON planly.assessment_events
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
