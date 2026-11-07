-- schema.sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- evidence.py
CREATE TABLE IF NOT EXISTS classrooms (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    track TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classrooms_owner ON classrooms(owner_id);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    current_revision INTEGER NOT NULL,
    parent_session_id TEXT,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS lesson_handoffs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    parent_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    demonstrated_skills TEXT NOT NULL DEFAULT '[]',
    misconceptions TEXT NOT NULL DEFAULT '[]',
    next_recommendation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lesson_handoffs_parent ON lesson_handoffs(owner_id, parent_session_id);

CREATE TABLE IF NOT EXISTS coach_conversation_memory (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    owner_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    covered_messages INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coach_turn_usage (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    model_name TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    context_characters INTEGER NOT NULL,
    cached_input_tokens INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    content TEXT NOT NULL,
    language TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner ON artifacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);

CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    artifact_id TEXT,
    frozen_code TEXT NOT NULL,
    frozen_language TEXT NOT NULL,
    source_revision INTEGER NOT NULL,
    elapsed_seconds INTEGER,
    assistance_level TEXT NOT NULL,
    mode TEXT NOT NULL,
    exposure_state TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_owner ON attempts(owner_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);

CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    competency_key TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    assistance_level TEXT NOT NULL,
    demonstrated INTEGER NOT NULL, -- boolean
    evidence_text TEXT NOT NULL,
    message_id TEXT,
    artifact_id TEXT,
    attempt_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (NOT (demonstrated = 1 AND assistance_level IN ('guided', 'tutor_supplied')))
);
CREATE INDEX IF NOT EXISTS idx_observations_owner ON observations(owner_id);
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);

CREATE TABLE IF NOT EXISTS micro_goals (
    id TEXT PRIMARY KEY, -- Maps to goal_id
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    description TEXT NOT NULL,
    competency_key TEXT NOT NULL,
    status TEXT NOT NULL,
    is_editable INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_micro_goals_owner ON micro_goals(owner_id);
CREATE INDEX IF NOT EXISTS idx_micro_goals_session ON micro_goals(session_id);

CREATE TABLE IF NOT EXISTS exposures (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    competency_key TEXT NOT NULL,
    exposure_count INTEGER NOT NULL,
    independent_success_count INTEGER NOT NULL,
    guided_count INTEGER NOT NULL,
    tutor_supplied_count INTEGER NOT NULL,
    last_exposed_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_assistance_level TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exposures_owner_competency ON exposures(owner_id, competency_key);

CREATE TABLE IF NOT EXISTS session_messages (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    content TEXT NOT NULL,
    artifact_revision_snapshot INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_messages_owner ON session_messages(owner_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);

-- runs.py
CREATE TABLE IF NOT EXISTS turn_runs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    client_request_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL,
    state TEXT NOT NULL,
    lane TEXT NOT NULL,
    message_id TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    fence INTEGER NOT NULL DEFAULT 1,
    decision TEXT, -- JSON
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turn_runs_owner ON turn_runs(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_runs_owner_client_req ON turn_runs(owner_id, client_request_id);

CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_run_events_owner ON run_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);

CREATE TABLE IF NOT EXISTS external_receipts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_payload TEXT, -- JSON
    cost_cents INTEGER NOT NULL DEFAULT 0,
    run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_receipts_owner_idemp ON external_receipts(owner_id, idempotency_key);

CREATE TABLE IF NOT EXISTS jobs_queue (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    lane TEXT NOT NULL,
    status TEXT NOT NULL,
    message_content TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_owner ON jobs_queue(owner_id);

-- corrections.py
CREATE TABLE IF NOT EXISTS tombstones (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tombstones_owner ON tombstones(owner_id);

CREATE TABLE IF NOT EXISTS corrections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    target_message_id TEXT NOT NULL,
    correction_text TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_owner ON corrections(owner_id);

CREATE TABLE IF NOT EXISTS memory_claims (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL,
    source_session_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_claims_owner ON memory_claims(owner_id);

CREATE TABLE IF NOT EXISTS cached_summaries (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    revision_up_to INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cached_summaries_owner ON cached_summaries(owner_id);

CREATE TABLE IF NOT EXISTS vector_cache (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    embedding TEXT NOT NULL, -- JSON array
    model_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vector_cache_owner ON vector_cache(owner_id);

CREATE TABLE IF NOT EXISTS keyword_cache (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_routing_preferences (
    owner_id TEXT NOT NULL,
    task TEXT NOT NULL,
    primary_model TEXT NOT NULL,
    fallbacks_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, task)
);
CREATE INDEX IF NOT EXISTS idx_model_routing_owner ON model_routing_preferences(owner_id);
CREATE INDEX IF NOT EXISTS idx_keyword_cache_owner ON keyword_cache(owner_id);

CREATE TABLE IF NOT EXISTS provider_api_keys (
    owner_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_provider_api_keys_owner ON provider_api_keys(owner_id);

CREATE TABLE IF NOT EXISTS invalidated_misconceptions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    misconception_text TEXT NOT NULL,
    invalidated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invalidated_misconceptions_owner ON invalidated_misconceptions(owner_id);

-- plans.py
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goals_owner ON goals(owner_id);

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_owner ON plans(owner_id);

CREATE TABLE IF NOT EXISTS owner_current_plan (
    owner_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capacities (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    capacity_key TEXT NOT NULL,
    level INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_capacities_owner ON capacities(owner_id);

CREATE TABLE IF NOT EXISTS owner_gaps (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    gap_description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_owner_gaps_owner ON owner_gaps(owner_id);

-- recall.py
CREATE TABLE IF NOT EXISTS recall_items (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    competency_key TEXT NOT NULL,
    next_review_at TEXT NOT NULL,
    interval_days INTEGER NOT NULL,
    ease_factor REAL NOT NULL,
    history TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recall_items_owner ON recall_items(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recall_items_owner_key ON recall_items(owner_id, competency_key);

CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    review_date TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_logs_owner ON review_logs(owner_id);

-- repairs.py
CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repairs_owner ON repairs(owner_id);

CREATE TABLE IF NOT EXISTS drill_tasks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    repair_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drill_tasks_owner ON drill_tasks(owner_id);

-- sources.py
CREATE TABLE IF NOT EXISTS source_docs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    track TEXT NOT NULL,
    filename TEXT NOT NULL,
    sha256_hash TEXT NOT NULL,
    turn_count INTEGER NOT NULL DEFAULT 0,
    extraction_quality TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_docs_owner ON source_docs(owner_id);

CREATE TABLE IF NOT EXISTS source_docs_raw (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_docs_raw_owner ON source_docs_raw(owner_id);

CREATE TABLE IF NOT EXISTS source_turns (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_source_turns_owner ON source_turns(owner_id);

CREATE TABLE IF NOT EXISTS pending_tasks (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    title TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    context_json TEXT NOT NULL, -- JSON
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_owner ON pending_tasks(owner_id);

-- executions.py
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    artifact_id TEXT,
    artifact_revision INTEGER NOT NULL,
    artifact_hash TEXT NOT NULL,
    test_suite_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    passed INTEGER NOT NULL, -- boolean
    tests_total INTEGER NOT NULL,
    tests_passed INTEGER NOT NULL,
    results TEXT NOT NULL, -- JSON
    stdout TEXT NOT NULL,
    stderr TEXT NOT NULL,
    stdout_truncated INTEGER NOT NULL, -- boolean
    duration_ms REAL NOT NULL,
    sandbox_provider TEXT NOT NULL,
    is_stale INTEGER NOT NULL, -- boolean
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_executions_owner ON executions(owner_id);
CREATE INDEX IF NOT EXISTS idx_executions_session ON executions(session_id);

-- indexer.py (episodes)
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT,
    source_document_id TEXT,
    kind TEXT NOT NULL,
    speaker TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    code_snippet TEXT,
    turn_index INTEGER,
    visibility TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dim INTEGER NOT NULL,
    index_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_owner ON episodes(owner_id);

-- Reviewed source summaries retain evidence links; they never grant mastery.
CREATE TABLE IF NOT EXISTS source_briefings (
    document_id TEXT PRIMARY KEY REFERENCES source_docs(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_turn_indices TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_recommendations (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    message_id TEXT NOT NULL REFERENCES session_messages(id) ON DELETE CASCADE,
    lesson TEXT
);
