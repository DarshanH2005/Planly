-- 00000000000007_canonical_sources_imports.sql
-- Sprint B05: Import the real chats and preserve pending work
--
-- Establishes canonical tables in planly schema for:
-- - source_documents: Raw imported chat files with cryptographic SHA256 hashes & quality metadata
-- - pending_tasks: Preserved pending questions, unsubmitted exercises, deferred topics, and follow-ups

-- 1. Source Documents
CREATE TABLE IF NOT EXISTS planly.source_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track TEXT NOT NULL CHECK (track IN ('dsa', 'cs', 'ai_ml')),
    filename TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    turn_count INT NOT NULL DEFAULT 0,
    extraction_quality TEXT NOT NULL DEFAULT 'clean',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_source_doc_owner_hash UNIQUE (owner_id, sha256_hash),
    CONSTRAINT uq_source_doc_owner_track UNIQUE (owner_id, track),
    CONSTRAINT uq_source_doc_owner_id UNIQUE (owner_id, id)
);

-- 2. Pending Tasks (Preserved pending questions, unsubmitted exercises, deferred topics)
CREATE TABLE IF NOT EXISTS planly.pending_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL,
    session_id UUID NOT NULL,
    task_type TEXT NOT NULL CHECK (task_type IN (
        'pending_question', 'unsubmitted_exercise', 'deferred_topic', 'unanswered_followup'
    )),
    title TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_pending_tasks_classroom FOREIGN KEY (owner_id, classroom_id)
        REFERENCES planly.classrooms(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_pending_tasks_session FOREIGN KEY (owner_id, session_id)
        REFERENCES planly.sessions(owner_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_pending_task_key UNIQUE (owner_id, classroom_id, task_type, title),
    CONSTRAINT uq_pending_tasks_owner_id UNIQUE (owner_id, id)
);

-- 3. Row Level Security
ALTER TABLE planly.source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE planly.pending_tasks ENABLE ROW LEVEL SECURITY;

-- Owner isolation policies
CREATE POLICY owner_source_documents ON planly.source_documents FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY owner_pending_tasks ON planly.pending_tasks FOR ALL USING (auth.uid() = owner_id);

-- Service role full access for FastAPI backend & ingestion worker
CREATE POLICY service_role_source_documents ON planly.source_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_pending_tasks ON planly.pending_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
