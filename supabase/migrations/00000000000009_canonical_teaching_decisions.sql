-- 00000000000009_canonical_teaching_decisions.sql
-- Sprint B08: Assessment before teaching in a resumable workflow
-- Authority: planly_architecture.md sections 7-8
--
-- Establishes canonical tables in planly schema for:
-- - teaching_decisions: Authoritative pedagogic decisions formulated before tutor replies
-- - lesson_micro_goals: Explicit, editable micro-goals per session
-- - exposures: Competency exposure tracking separating independent success from guided/supplied assistance

-- 1. Teaching Decisions Table
CREATE TABLE IF NOT EXISTS planly.teaching_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    expected_revision INT NOT NULL,
    assessment TEXT NOT NULL,
    uncertainty NUMERIC NOT NULL CHECK (uncertainty >= 0.0 AND uncertainty <= 1.0),
    next_action TEXT NOT NULL CHECK (next_action IN (
        'probe', 'hint', 'advance', 'challenge', 'review', 'diagnostic'
    )),
    reveal_limit INT NOT NULL DEFAULT 0 CHECK (reveal_limit >= 0),
    observed_success_criteria TEXT[] NOT NULL DEFAULT '{}',
    rationale TEXT NOT NULL,
    model_version TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
    candidate_explanations TEXT[] NOT NULL DEFAULT '{}',
    discriminating_probe TEXT,
    uncertainty_reason TEXT,
    transition TEXT NOT NULL DEFAULT 'continue' CHECK (transition IN (
        'continue', 'repair', 'advance', 'defer', 'stop'
    )),
    policy_version TEXT NOT NULL DEFAULT 'v1',
    goal_id TEXT,
    step_id TEXT,
    assistance_event TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_teaching_decisions_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_teaching_decisions_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_teaching_decisions_session
    ON planly.teaching_decisions (owner_id, session_id, created_at);

ALTER TABLE planly.teaching_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_teaching_decisions_policy ON planly.teaching_decisions
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 2. Lesson Micro-Goals Table
CREATE TABLE IF NOT EXISTS planly.lesson_micro_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    description TEXT NOT NULL,
    competency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'achieved', 'deferred')),
    is_editable BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_lesson_micro_goals_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_lesson_micro_goals_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_micro_goals_session
    ON planly.lesson_micro_goals (owner_id, session_id);

ALTER TABLE planly.lesson_micro_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_lesson_micro_goals_policy ON planly.lesson_micro_goals
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- 3. Competency Exposures Table
CREATE TABLE IF NOT EXISTS planly.exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    competency_key TEXT NOT NULL,
    exposure_count INT NOT NULL DEFAULT 0 CHECK (exposure_count >= 0),
    independent_success_count INT NOT NULL DEFAULT 0 CHECK (independent_success_count >= 0),
    guided_count INT NOT NULL DEFAULT 0 CHECK (guided_count >= 0),
    tutor_supplied_count INT NOT NULL DEFAULT 0 CHECK (tutor_supplied_count >= 0),
    last_exposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_assistance_level TEXT,
    CONSTRAINT uq_exposures_owner_competency UNIQUE (owner_id, competency_key),
    CONSTRAINT uq_exposures_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX IF NOT EXISTS idx_exposures_owner_competency
    ON planly.exposures (owner_id, competency_key);

ALTER TABLE planly.exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_exposures_policy ON planly.exposures
    FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
