-- 00000000000005_canonical_classrooms_evidence.sql
-- Sprint B03: Classrooms, Sessions, Versioned Artifacts & Learning Observations
--
-- Establishes canonical learning entities in planly schema with owner-consistent
-- foreign keys, immutable artifact revisions, and strict assistance/evidence tracking.

-- 1. Classrooms
CREATE TABLE IF NOT EXISTS planly.classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_classrooms_owner_id UNIQUE (owner_id, id)
);

-- 2. Sessions
CREATE TABLE IF NOT EXISTS planly.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL,
    stage TEXT NOT NULL DEFAULT 'foundation',
    mode TEXT NOT NULL DEFAULT 'practice',
    status TEXT NOT NULL DEFAULT 'active',
    current_revision INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_sessions_classroom FOREIGN KEY (owner_id, classroom_id)
        REFERENCES planly.classrooms(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_sessions_owner_id UNIQUE (owner_id, id)
);

-- 3. Versioned Immutable Artifacts
CREATE TABLE IF NOT EXISTS planly.artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    revision INT NOT NULL,
    content TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'python',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_artifacts_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_artifacts_session_revision UNIQUE (owner_id, session_id, revision),
    CONSTRAINT uq_artifacts_owner_id UNIQUE (owner_id, id)
);

-- 4. Messages
CREATE TABLE IF NOT EXISTS planly.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('learner', 'tutor', 'system')),
    content TEXT NOT NULL,
    artifact_revision_snapshot INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_messages_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_messages_owner_id UNIQUE (owner_id, id)
);

-- 5. Attempts (immutable frozen submissions / task attempts)
CREATE TABLE IF NOT EXISTS planly.attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    artifact_id UUID,
    frozen_code TEXT NOT NULL DEFAULT '',
    frozen_language TEXT NOT NULL DEFAULT 'python',
    source_revision INT NOT NULL,
    elapsed_seconds INT CHECK (elapsed_seconds IS NULL OR elapsed_seconds >= 0),
    assistance_level TEXT NOT NULL CHECK (assistance_level IN (
        'independent', 'guided', 'tutor_supplied', 'unassessed', 'unknown'
    )),
    mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('learn', 'practice', 'strict')),
    exposure_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_attempts_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_attempts_artifact FOREIGN KEY (owner_id, artifact_id)
        REFERENCES planly.artifacts(owner_id, id) ON DELETE SET NULL,
    CONSTRAINT uq_attempts_owner_id UNIQUE (owner_id, id)
);

-- 6. Learning Observations & Evidence
CREATE TABLE IF NOT EXISTS planly.learning_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    competency_key TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'learner_work', 'tutor_explanation', 'self_report',
        'derived_inference', 'execution_evidence'
    )),
    assistance_level TEXT NOT NULL CHECK (assistance_level IN (
        'independent', 'guided', 'tutor_supplied', 'unassessed', 'unknown'
    )),
    demonstrated BOOLEAN NOT NULL DEFAULT false,
    evidence_text TEXT NOT NULL,
    message_id UUID,
    artifact_id UUID,
    attempt_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_obs_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_obs_message FOREIGN KEY (owner_id, message_id)
        REFERENCES planly.messages(owner_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_obs_artifact FOREIGN KEY (owner_id, artifact_id)
        REFERENCES planly.artifacts(owner_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_obs_attempt FOREIGN KEY (owner_id, attempt_id)
        REFERENCES planly.attempts(owner_id, id) ON DELETE SET NULL,
    CONSTRAINT uq_observations_owner_id UNIQUE (owner_id, id),
    -- Invariant B03-AC2: Guided or tutor-supplied work cannot be recorded as independent demonstration
    CONSTRAINT chk_no_guided_independent_success CHECK (
        NOT (
            demonstrated = true
            AND (assistance_level IN ('guided', 'tutor_supplied') OR source_kind = 'tutor_explanation')
        )
    )
);

-- 7. Row Level Security
ALTER TABLE planly.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.learning_observations ENABLE ROW LEVEL SECURITY;

-- Owner isolation policies
CREATE POLICY owner_classrooms ON planly.classrooms FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_sessions ON planly.sessions FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_artifacts ON planly.artifacts FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_messages ON planly.messages FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_attempts ON planly.attempts FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_observations ON planly.learning_observations FOR ALL USING (auth.uid() = owner_id);

-- Service role full access for FastAPI backend
CREATE POLICY service_role_classrooms ON planly.classrooms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_sessions ON planly.sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_artifacts ON planly.artifacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_messages ON planly.messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_attempts ON planly.attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_observations ON planly.learning_observations FOR ALL TO service_role USING (true) WITH CHECK (true);

