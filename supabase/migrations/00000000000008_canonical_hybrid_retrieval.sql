-- 00000000000008_canonical_hybrid_retrieval.sql
-- Sprint B07: Hybrid episode retrieval and explicit learning links
-- Authority: planly_architecture.md sections 5-6, 11
--
-- Establishes canonical tables in planly schema for:
-- - episodes: Source-linked learner episodes and reference units with model/dimension/index version metadata
-- - learning_links: Explicit prerequisite, supersession, and contradictory relationships for bounded graph expansion

-- 1. Episodes (Personal learner episodes & reference units)
CREATE TABLE IF NOT EXISTS planly.episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for shared/global reference units
    session_id UUID REFERENCES planly.sessions(id) ON DELETE SET NULL,
    source_document_id UUID,
    turn_index INT,
    kind TEXT NOT NULL DEFAULT 'personal_episode' CHECK (kind IN ('personal_episode', 'reference_knowledge')),
    speaker TEXT NOT NULL DEFAULT 'learner' CHECK (speaker IN ('learner', 'tutor', 'system', 'reference')),
    episode_type TEXT NOT NULL DEFAULT 'learner_work' CHECK (episode_type IN (
        'learner_work', 'tutor_feedback', 'reference', 'concept_explanation', 'diagnostic'
    )),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    code_snippet TEXT,
    competency_keys TEXT[] NOT NULL DEFAULT '{}',
    visibility TEXT NOT NULL DEFAULT 'candidate_facing' CHECK (visibility IN ('candidate_facing', 'evaluator_only')),
    is_evaluator_only BOOLEAN GENERATED ALWAYS AS (visibility = 'evaluator_only') STORED,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_dim INT NOT NULL DEFAULT 1536,
    index_version TEXT NOT NULL DEFAULT 'v1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_episodes_owner_doc FOREIGN KEY (owner_id, source_document_id)
        REFERENCES planly.source_documents(owner_id, id) ON DELETE SET NULL,
    CONSTRAINT uq_episodes_owner_id UNIQUE (owner_id, id)
);

-- Index for owner-isolated, candidate-facing retrieval with time cutoffs
CREATE INDEX IF NOT EXISTS idx_episodes_retrieval_filter
ON planly.episodes (owner_id, visibility, created_at);

CREATE INDEX IF NOT EXISTS idx_episodes_session
ON planly.episodes (owner_id, session_id);

CREATE INDEX IF NOT EXISTS idx_episodes_kind_visibility
ON planly.episodes (kind, visibility);

-- Full-text search GIN index on content
CREATE INDEX IF NOT EXISTS idx_episodes_fts
ON planly.episodes USING gin (to_tsvector('english', content));

-- 2. Explicit Learning Links Graph
CREATE TABLE IF NOT EXISTS planly.learning_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'requires_prerequisite', 'supersedes', 'contradicts', 'reinforces'
    )),
    confidence NUMERIC NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    provenance TEXT NOT NULL DEFAULT 'curriculum_rule',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_learning_links UNIQUE (owner_id, source_id, target_id, relation_type),
    CONSTRAINT uq_learning_links_owner_id UNIQUE (owner_id, id)
);

-- Compatibility alias for prerequisite links
CREATE OR REPLACE VIEW planly.prerequisite_links AS
SELECT id, owner_id, source_id AS source_key, target_id AS target_key,
       relation_type, metadata, created_at
FROM planly.learning_links;

CREATE INDEX IF NOT EXISTS idx_learning_links_source
ON planly.learning_links (owner_id, source_id);

CREATE INDEX IF NOT EXISTS idx_learning_links_target
ON planly.learning_links (owner_id, target_id);

-- 3. Row Level Security
ALTER TABLE planly.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.learning_links ENABLE ROW LEVEL SECURITY;

-- Owner isolation policies: personal episodes only visible to owner, global references visible to all authenticated
CREATE POLICY owner_episodes ON planly.episodes
    FOR ALL
    USING (owner_id IS NULL OR auth.uid() = owner_id);

CREATE POLICY owner_learning_links ON planly.learning_links
    FOR ALL
    USING (auth.uid() = owner_id);

-- Service role full access
CREATE POLICY service_role_episodes ON planly.episodes
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY service_role_learning_links ON planly.learning_links
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
