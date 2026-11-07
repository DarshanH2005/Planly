from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, model_validator

"""
Sprint B03: Versioned Classrooms, Artifacts & Evidence Contracts

Defines canonical Pydantic contracts for:
- ContextPacket: input context for teaching decision
- TeachingDecision: structured pedagogical choice preceding learner feedback
- RunReceipt: asynchronous run confirmation with event endpoints
- ErrorEnvelope: structured error responses
- LearningObservation: immutable evidence record enforcing B03-AC2 invariant
"""


class SourceKind(str, Enum):
    LEARNER_WORK = "learner_work"
    TUTOR_EXPLANATION = "tutor_explanation"
    SELF_REPORT = "self_report"
    DERIVED_INFERENCE = "derived_inference"
    EXECUTION_EVIDENCE = "execution_evidence"


class AssistanceLevel(str, Enum):
    INDEPENDENT = "independent"
    GUIDED = "guided"
    TUTOR_SUPPLIED = "tutor_supplied"
    UNASSESSED = "unassessed"
    UNKNOWN = "unknown"


class SessionStage(str, Enum):
    FOUNDATION = "foundation"
    OA = "oa"
    TECHNICAL_A = "technical_a"
    TECHNICAL_B = "technical_b"
    ENGINEERING = "engineering"
    PROJECT = "project"
    BEHAVIOURAL = "behavioural"


class SessionMode(str, Enum):
    LEARN = "learn"
    PRACTICE = "practice"
    STRICT = "strict"


class LearningObservation(BaseModel):
    id: str
    owner_id: str
    session_id: str
    competency_key: str
    source_kind: SourceKind
    assistance_level: AssistanceLevel
    demonstrated: bool = False
    evidence_text: str
    message_id: Optional[str] = None
    artifact_id: Optional[str] = None
    attempt_id: Optional[str] = None
    created_at: Optional[str] = None

    @model_validator(mode="after")
    def validate_no_guided_independent_success(self) -> "LearningObservation":
        """
        B03-AC2 Invariant:
        Guided code or tutor-supplied answers cannot be claimed as independent demonstrations.
        """
        if self.demonstrated:
            if self.assistance_level in (AssistanceLevel.GUIDED, AssistanceLevel.TUTOR_SUPPLIED):
                raise ValueError(
                    f"Assistance level '{self.assistance_level.value}' cannot be recorded as an independent demonstrated success (B03-AC2)."
                )
            if self.source_kind == SourceKind.TUTOR_EXPLANATION:
                raise ValueError(
                    "Tutor explanations cannot be recorded as demonstrated learner understanding (B03-AC2)."
                )
        return self


class ArtifactRecord(BaseModel):
    id: str
    owner_id: str
    session_id: str
    revision: int = Field(ge=1)
    content: str
    language: str = "python"
    created_at: Optional[str] = None


class MessageRecord(BaseModel):
    id: str
    owner_id: str
    session_id: str
    sender_role: str = Field(pattern="^(learner|tutor|system)$")
    content: str
    artifact_revision_snapshot: Optional[int] = None
    created_at: Optional[str] = None


class AttemptRecord(BaseModel):
    id: str
    owner_id: str
    session_id: str
    artifact_id: Optional[str] = None
    frozen_code: str = ""
    frozen_language: str = "python"
    source_revision: int = Field(ge=1)
    elapsed_seconds: Optional[int] = Field(default=None, ge=0)
    assistance_level: AssistanceLevel
    mode: SessionMode = SessionMode.PRACTICE
    exposure_state: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class ModeRecord(BaseModel):
    mode: SessionMode
    coaching_permitted: bool
    strict_deadline_seconds: Optional[int] = None
    hints_enabled: bool = True
    reveal_limit: int = Field(default=0, ge=0)
    requires_clean_submission: bool = False


class ExposureRecord(BaseModel):
    owner_id: str
    competency_key: str
    exposure_count: int = Field(default=0, ge=0)
    independent_success_count: int = Field(default=0, ge=0)
    guided_count: int = Field(default=0, ge=0)
    tutor_supplied_count: int = Field(default=0, ge=0)
    last_exposed_at: Optional[str] = None
    last_assistance_level: Optional[AssistanceLevel] = None


class ClassroomRecord(BaseModel):
    id: str
    owner_id: str
    track: str
    title: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SessionRecord(BaseModel):
    id: str
    owner_id: str
    classroom_id: str
    stage: SessionStage = SessionStage.FOUNDATION
    mode: SessionMode = SessionMode.PRACTICE
    status: str = "active"
    current_revision: int = Field(default=1, ge=1)
    parent_session_id: Optional[str] = None
    title: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ContextPacket(BaseModel):
    session_id: str
    owner_id: str
    active_revision: int = Field(ge=1)
    artifact_content: str
    pending_question: Optional[str] = None
    permitted_references: List[str] = Field(default_factory=list)
    observed_competencies: List[str] = Field(default_factory=list)
    recent_messages: List[Dict[str, Any]] = Field(default_factory=list)
    parent_context: Optional[Dict[str, Any]] = None
    source_episodes: List[Dict[str, Any]] = Field(default_factory=list)
    mode: SessionMode = SessionMode.PRACTICE
    exposure_snapshot: Optional[ExposureRecord] = None
    source_coverage: List[str] = Field(default_factory=list)
    superseded_evidence: List[Dict[str, Any]] = Field(default_factory=list)
    track: str = "dsa"
    activity_id: Optional[str] = None
    competency_key: Optional[str] = None



class TeachingDecision(BaseModel):
    decision_id: str
    session_id: str
    owner_id: str
    expected_revision: int = Field(ge=1)
    assessment: str
    uncertainty: float = Field(ge=0.0, le=1.0)
    next_action: str = Field(description="probe, hint, advance, challenge, review, or diagnostic")
    reveal_limit: int = Field(default=0, ge=0)
    observed_success_criteria: List[str] = Field(default_factory=list)
    rationale: str
    model_version: str = "gemini-3.8-flash"
    candidate_explanations: List[str] = Field(default_factory=list)
    discriminating_probe: Optional[str] = None
    uncertainty_reason: Optional[str] = None
    transition: str = "continue"
    policy_version: str = "v1"
    goal_id: Optional[str] = None
    step_id: Optional[str] = None
    assistance_event: Optional[str] = None


class LessonMicroGoal(BaseModel):
    goal_id: str
    session_id: str
    owner_id: str
    description: str
    competency_key: str
    status: str = "in_progress"
    is_editable: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ActivityDefinition(BaseModel):
    id: str
    track: str
    title: str
    competency_key: str
    prerequisites: List[str] = Field(default_factory=list)
    micro_goal: str
    statement: str
    examples: List[Dict[str, Any]] = Field(default_factory=list)
    reference_checks: List[Dict[str, Any]] = Field(default_factory=list)
    evaluator_context: Optional[Dict[str, Any]] = None
    visibility: str = "candidate_facing"
    starter_code: str = ""


class RunReceipt(BaseModel):
    run_id: str
    session_id: str
    message_id: str
    accepted_revision: int
    status_url: str
    events_url: str


class ErrorEnvelope(BaseModel):
    code: str
    message: str
    field_errors: Optional[Dict[str, str]] = None
    expected_revision: Optional[int] = None


class RunState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunLane(str, Enum):
    FOREGROUND = "foreground"
    BACKGROUND = "background"


class EventType(str, Enum):
    QUEUED = "queued"
    THINKING = "thinking"
    DECISION = "decision"
    CHUNK = "chunk"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


class ExternalCallStatus(str, Enum):
    STARTED = "started"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNCERTAIN = "uncertain"


class RunEvent(BaseModel):
    id: str
    owner_id: str
    run_id: str
    seq: int = Field(ge=1)
    event_type: EventType
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None


class TurnRunRecord(BaseModel):
    id: str
    owner_id: str
    classroom_id: str
    session_id: str
    client_request_id: str
    expected_revision: int = Field(ge=1)
    state: RunState = RunState.QUEUED
    lane: RunLane = RunLane.FOREGROUND
    message_id: Optional[str] = None
    lease_owner: Optional[str] = None
    lease_expires_at: Optional[str] = None
    fence: int = Field(default=1, ge=1)
    decision: Optional[TeachingDecision] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ExternalCallReceipt(BaseModel):
    id: str
    owner_id: str
    idempotency_key: str
    call_type: str
    status: ExternalCallStatus
    request_hash: str
    response_payload: Optional[Dict[str, Any]] = None
    cost_cents: int = 0
    run_id: Optional[str] = None
    created_at: Optional[str] = None


class RunStatusResponse(BaseModel):
    run_id: str
    session_id: str
    state: RunState
    expected_revision: int
    decision: Optional[TeachingDecision] = None
    error: Optional[str] = None
    events_count: int = 0
    events_url: str


class RunEventsResponse(BaseModel):
    run_id: str
    events: List[RunEvent]
    latest_seq: int
    is_complete: bool


class PendingTaskType(str, Enum):
    PENDING_QUESTION = "pending_question"
    UNSUBMITTED_EXERCISE = "unsubmitted_exercise"
    DEFERRED_TOPIC = "deferred_topic"
    UNANSWERED_FOLLOWUP = "unanswered_followup"


class PendingTaskStatus(str, Enum):
    PENDING = "pending"
    RESOLVED = "resolved"
    CANCELLED = "cancelled"


class PendingTaskRecord(BaseModel):
    id: str
    owner_id: str
    classroom_id: str
    session_id: str
    task_type: PendingTaskType
    title: str
    prompt_text: str
    context_json: Dict[str, Any] = Field(default_factory=dict)
    status: PendingTaskStatus = PendingTaskStatus.PENDING
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SourceDocumentRecord(BaseModel):
    id: str
    owner_id: str
    track: str
    filename: str
    sha256_hash: str
    turn_count: int = 0
    extraction_quality: str = "clean"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ImportSummaryResponse(BaseModel):
    owner_id: str
    tracks_imported: List[str]
    documents_ingested: int
    turns_extracted: int
    artifacts_created: int
    observations_staged: int
    pending_tasks_created: int
    warnings: List[str] = Field(default_factory=list)


class EpisodeRecord(BaseModel):
    id: str
    owner_id: Optional[str] = None
    session_id: Optional[str] = None
    source_document_id: Optional[str] = None
    kind: str = "personal_episode"
    speaker: str = "learner"
    title: str
    content: str
    code_snippet: Optional[str] = None
    turn_index: Optional[int] = None
    visibility: str = "candidate_facing"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    index_version: str = "v1"
    created_at: Optional[str] = None


class LearningLinkRecord(BaseModel):
    id: str
    owner_id: str
    source_id: str
    target_id: str
    relation_type: str
    confidence: float = 1.0
    provenance: str
    created_at: Optional[str] = None


class RetrievalCandidate(BaseModel):
    episode: EpisodeRecord
    score: float
    lexical_rank: Optional[int] = None
    vector_rank: Optional[int] = None
    rrf_score: float = 0.0


# --- Sprint B10: Verified Python Execution & Execution Evidence Contracts ---

class ExecutionStatus(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    ERROR = "error"
    STATIC_REVIEW_ONLY = "static_review_only"


class TestCaseDefinition(BaseModel):
    name: str
    input_args: List[Any]
    expected_output: Any
    is_hidden: bool = False


class TestResult(BaseModel):
    name: str
    passed: bool
    expected: Optional[str] = None
    actual: Optional[str] = None
    error: Optional[str] = None
    execution_time_ms: float = 0.0


class ExecutionRecord(BaseModel):
    id: str
    session_id: str
    owner_id: str
    artifact_id: Optional[str] = None
    artifact_revision: int
    artifact_hash: str
    test_suite_hash: str
    status: ExecutionStatus
    passed: bool
    tests_total: int
    tests_passed: int
    results: List[TestResult] = Field(default_factory=list)
    stdout: str = ""
    stderr: str = ""
    stdout_truncated: bool = False
    duration_ms: float = 0.0
    sandbox_provider: str = "subprocess"
    is_stale: bool = False
    created_at: str


class ExecutionRequestInput(BaseModel):
    session_id: Optional[str] = None
    revision: Optional[int] = None
    test_suite_id: Optional[str] = "act_dsa_two_sum_sorted"
    code_override: Optional[str] = None


class ExecutionResponse(BaseModel):
    execution: ExecutionRecord
    is_stale: bool = False
    observation_recorded: Optional[bool] = False
    finite_test_pass: bool = False
    independent_mastery: bool = False  # B10: Passing finite tests is not a correctness proof or independent mastery by itself
    pedagogical_note: str = ""
    stale_warning: Optional[str] = None
