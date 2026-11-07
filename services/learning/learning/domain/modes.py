"""
Sprint B18: Strict OA Lifecycle and Immutable Resource Policy
Authority: PLANLY_BUILD_SPEC.md §16-17; B18_strict_oa.md

Enforces:
- B18-AC1: Server deadline wins over a forged browser timer and survives refresh.
- B18-AC2: Hidden answers, internal test suites, and private solutions cannot enter candidate payloads before finish.
- B18-AC3: Duplicate finalize is idempotent and practice conversion preserves the original strict attempt.
- Failure to Prevent: A timed practice session with hidden AI hints is not an unassisted OA result.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple
import uuid
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SessionMode,
    SessionStage,
    AssistanceLevel,
    AttemptRecord,
    SourceKind,
)


class ResourcePolicy(BaseModel):
    docs: bool = False
    ai: bool = False
    hints: bool = False
    notes: bool = False


class ImmutableExerciseVersion(BaseModel):
    prompt_id: str
    prompt_version: int = 1
    rubric_id: str = "rubric-oa-v1"
    rubric_version: int = 1
    bundle_hash: str = "bundle-hash-v1"
    title: str
    statement: str
    starter_code: str = ""
    public_tests: List[Dict[str, Any]] = Field(default_factory=list)
    hidden_tests: List[Dict[str, Any]] = Field(default_factory=list)  # Hidden from candidate!
    private_solution: str = ""  # Hidden from candidate!
    clarification_branches: Dict[str, Dict[str, str]] = Field(default_factory=dict)
    # format: { "branch_id": { "question": "...", "answer": "..." } }


class AssessmentDraft(BaseModel):
    prompt_id: str
    revision: int = 1
    code: str
    language: str = "python"
    notes: str = ""
    saved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AssessmentEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    owner_id: str
    kind: str  # 'clarification', 'conversion', 'interruption', 'timeout', 'finalize'
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OASessionRecord(BaseModel):
    id: str
    owner_id: str
    classroom_id: str
    pack_id: str
    pack_version: int = 1
    stage: SessionStage = SessionStage.OA
    mode: SessionMode = SessionMode.STRICT
    state: str = "running"  # "running", "finalized", "converted"
    started_at: datetime
    deadline_at: datetime  # Server authoritative deadline
    finalized_at: Optional[datetime] = None
    finish_reason: Optional[str] = None  # "submitted", "timeout", "converted_to_practice"
    resource_policy: ResourcePolicy = Field(default_factory=ResourcePolicy)
    exercises: List[ImmutableExerciseVersion] = Field(default_factory=list)
    drafts: Dict[str, AssessmentDraft] = Field(default_factory=dict)
    revealed_clarifications: List[str] = Field(default_factory=list)  # branch_ids
    frozen_attempts: List[AttemptRecord] = Field(default_factory=list)
    is_interrupted: bool = False
    is_assisted: bool = False
    linked_prior_session_id: Optional[str] = None
    version: int = 1


# In-memory session store for tests and fast runtime lookups
_oa_sessions: Dict[str, OASessionRecord] = {}
_oa_events: Dict[str, List[AssessmentEvent]] = {}


def reset_oa_storage():
    """Utility to clear in-memory assessment records between test runs."""
    _oa_sessions.clear()
    _oa_events.clear()


# ==============================================================================
# B18-AC1: Server Deadline & Session Lifecycle
# ==============================================================================

def start_oa_session(
    owner_id: str,
    classroom_id: str,
    pack_id: str,
    pack_version: int,
    duration_minutes: int,
    exercises: List[ImmutableExerciseVersion],
    resource_policy: Optional[ResourcePolicy] = None,
    server_now: Optional[datetime] = None,
    session_id: Optional[str] = None,
) -> OASessionRecord:
    """
    B18-AC1: Initializes an immutable strict assessment session with server-persisted
    start and deadline timestamps. Browser timers are purely client display;
    all state changes validate against server_now.
    """
    now = server_now or datetime.now(timezone.utc)
    deadline = now + timedelta(minutes=duration_minutes)

    if resource_policy is None:
        # Strict OA defaults: zero outside resources, no AI, no hints
        resource_policy = ResourcePolicy(docs=False, ai=False, hints=False, notes=False)

    sid = session_id or str(uuid.uuid4())
    drafts: Dict[str, AssessmentDraft] = {}
    for ex in exercises:
        drafts[ex.prompt_id] = AssessmentDraft(
            prompt_id=ex.prompt_id,
            revision=1,
            code=ex.starter_code,
            language="python",
            notes="",
            saved_at=now,
        )

    session = OASessionRecord(
        id=sid,
        owner_id=owner_id,
        classroom_id=classroom_id,
        pack_id=pack_id,
        pack_version=pack_version,
        stage=SessionStage.OA,
        mode=SessionMode.STRICT,
        state="running",
        started_at=now,
        deadline_at=deadline,
        resource_policy=resource_policy,
        exercises=exercises,
        drafts=drafts,
        revealed_clarifications=[],
        is_interrupted=False,
        is_assisted=False,
        version=1,
    )
    _oa_sessions[sid] = session
    return session


def get_oa_session(session_id: str) -> Optional[OASessionRecord]:
    return _oa_sessions.get(session_id)


def save_oa_draft(
    session: OASessionRecord,
    prompt_id: str,
    code: str,
    language: str,
    notes: str,
    expected_revision: int,
    server_now: Optional[datetime] = None,
) -> Tuple[bool, Optional[str], Optional[AssessmentDraft]]:
    """
    B18-AC1 & B18-AC3: Validates draft saves against server deadline and optimistic concurrency.
    - If server_now > deadline_at: rejected with DEADLINE_PASSED.
    - If current draft revision != expected_revision: rejected with VERSION_CONFLICT.
    """
    now = server_now or datetime.now(timezone.utc)

    # 1. State check
    if session.state != "running":
        return False, f"SESSION_NOT_RUNNING: Session state is {session.state}", None

    # 2. Server deadline check (B18-AC1)
    if now > session.deadline_at:
        return False, "DEADLINE_PASSED", None

    # 3. Draft existence check
    current_draft = session.drafts.get(prompt_id)
    if not current_draft:
        return False, f"UNKNOWN_PROMPT: Prompt {prompt_id} not part of this session", None

    # 4. Optimistic concurrency control (AC11)
    if current_draft.revision != expected_revision:
        return False, "VERSION_CONFLICT", current_draft

    # 5. Persist updated draft
    new_revision = current_draft.revision + 1
    updated_draft = AssessmentDraft(
        prompt_id=prompt_id,
        revision=new_revision,
        code=code,
        language=language,
        notes=notes,
        saved_at=now,
    )
    session.drafts[prompt_id] = updated_draft
    session.version += 1
    return True, None, updated_draft


# ==============================================================================
# B18-AC2: Strict Candidate Payload Sanitization & Constrained Clarifications
# ==============================================================================

def get_candidate_safe_payload(
    session: OASessionRecord,
    server_now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    B18-AC2: Candidate payloads contain zero private references, hidden test suites,
    or unrevealed answers. All unasked clarifications show questions only.
    Server deadline and remaining seconds are computed from authoritative server clock.
    """
    now = server_now or datetime.now(timezone.utc)
    remaining_seconds = max(0, int((session.deadline_at - now).total_seconds()))
    is_expired = now > session.deadline_at

    candidate_exercises = []
    for ex in session.exercises:
        # Clarifications projection: questions only, answer only if explicitly revealed
        available_clarifications = []
        revealed_clarifications = []
        for branch_id, branch in ex.clarification_branches.items():
            if branch_id in session.revealed_clarifications:
                revealed_clarifications.append({
                    "id": branch_id,
                    "question": branch["question"],
                    "answer": branch["answer"],
                })
            else:
                available_clarifications.append({
                    "id": branch_id,
                    "question": branch["question"],
                })

        candidate_exercises.append({
            "prompt_id": ex.prompt_id,
            "title": ex.title,
            "statement": ex.statement,
            "starter_code": ex.starter_code,
            "public_tests": ex.public_tests,
            "available_clarifications": available_clarifications,
            "revealed_clarifications": revealed_clarifications,
            # Explicitly omitted: ex.hidden_tests, ex.private_solution, rubrics!
        })

    candidate_drafts = {
        pid: {
            "prompt_id": d.prompt_id,
            "revision": d.revision,
            "code": d.code,
            "language": d.language,
            "notes": d.notes,
            "saved_at": d.saved_at.isoformat(),
        }
        for pid, d in session.drafts.items()
    }

    return {
        "session_id": session.id,
        "classroom_id": session.classroom_id,
        "pack_id": session.pack_id,
        "stage": session.stage.value,
        "mode": session.mode.value,
        "state": session.state,
        "started_at": session.started_at.isoformat(),
        "deadline_at": session.deadline_at.isoformat(),
        "server_now": now.isoformat(),
        "remaining_seconds": remaining_seconds,
        "is_expired": is_expired,
        "resource_policy": session.resource_policy.model_dump(),
        "exercises": candidate_exercises,
        "drafts": candidate_drafts,
        "is_interrupted": session.is_interrupted,
        "is_assisted": session.is_assisted,
        "finish_reason": session.finish_reason,
    }


def request_oa_clarification(
    session: OASessionRecord,
    prompt_id: str,
    branch_id: str,
    server_now: Optional[datetime] = None,
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """
    B18-AC2: Follows a constrained clarification policy. Only authored branches can
    be queried. Free-form AI answers and unauthorized branches are rejected.
    """
    now = server_now or datetime.now(timezone.utc)

    if session.state != "running":
        return False, "SESSION_NOT_RUNNING", None

    if now > session.deadline_at:
        return False, "DEADLINE_PASSED", None

    # Find prompt
    exercise = next((ex for ex in session.exercises if ex.prompt_id == prompt_id), None)
    if not exercise:
        return False, f"UNKNOWN_PROMPT: {prompt_id}", None

    branch = exercise.clarification_branches.get(branch_id)
    if not branch:
        return False, f"VALIDATION_ERROR: Clarification branch '{branch_id}' is not an authored option", None

    # Record revealed branch
    if branch_id not in session.revealed_clarifications:
        session.revealed_clarifications.append(branch_id)

    evt = AssessmentEvent(
        session_id=session.id,
        owner_id=session.owner_id,
        kind="clarification",
        payload={
            "prompt_id": prompt_id,
            "branch_id": branch_id,
            "question": branch["question"],
            "answer": branch["answer"],
        },
        created_at=now,
    )
    _oa_events.setdefault(session.id, []).append(evt)

    return True, None, {
        "prompt_id": prompt_id,
        "branch_id": branch_id,
        "question": branch["question"],
        "answer": branch["answer"],
    }


# ==============================================================================
# B18-AC3: Duplicate Finalize Idempotency & Practice Conversion
# ==============================================================================

def finalize_oa_session(
    session: OASessionRecord,
    finish_reason: str = "submitted",
    final_drafts: Optional[List[Dict[str, Any]]] = None,
    server_now: Optional[datetime] = None,
) -> Tuple[bool, OASessionRecord, List[AttemptRecord]]:
    """
    B18-AC3: Finalizes the session and freezes attempt records.
    - Idempotent: duplicate calls return existing finalized record.
    - Server deadline enforcement: if server_now > deadline_at, finish_reason is
      coerced to "timeout", and any late code sent in final_drafts is ignored;
      only pre-deadline server-saved drafts are frozen.
    """
    now = server_now or datetime.now(timezone.utc)

    # 1. Idempotency guard: if already finalized, return existing attempts
    if session.state == "finalized":
        return True, session, session.frozen_attempts

    # 2. Check server deadline
    effective_finish_reason = finish_reason
    if now > session.deadline_at:
        effective_finish_reason = "timeout"

    # 3. Apply on-time final drafts if submitted before deadline
    if effective_finish_reason != "timeout" and final_drafts:
        for fd in final_drafts:
            pid = fd.get("prompt_id")
            if pid and pid in session.drafts:
                exp_rev = fd.get("expected_revision", session.drafts[pid].revision)
                if session.drafts[pid].revision == exp_rev:
                    session.drafts[pid] = AssessmentDraft(
                        prompt_id=pid,
                        revision=session.drafts[pid].revision + 1,
                        code=fd.get("code", session.drafts[pid].code),
                        language=fd.get("language", "python"),
                        notes=fd.get("notes", ""),
                        saved_at=now,
                    )

    # 4. Freeze attempts for all exercises
    attempts: List[AttemptRecord] = []
    assistance = AssistanceLevel.GUIDED if session.is_assisted else AssistanceLevel.INDEPENDENT

    for ex in session.exercises:
        draft = session.drafts.get(ex.prompt_id)
        frozen_code = draft.code if draft else ex.starter_code
        source_rev = draft.revision if draft else 1
        elapsed = int((now - session.started_at).total_seconds())

        attempt = AttemptRecord(
            id=str(uuid.uuid4()),
            owner_id=session.owner_id,
            session_id=session.id,
            artifact_id=None,
            frozen_code=frozen_code,
            frozen_language="python",
            source_revision=source_rev,
            elapsed_seconds=max(0, elapsed),
            assistance_level=assistance,
            mode=session.mode,
            exposure_state={
                "pack_id": session.pack_id,
                "prompt_id": ex.prompt_id,
                "finish_reason": effective_finish_reason,
                "is_interrupted": session.is_interrupted,
                "is_assisted": session.is_assisted,
            },
            created_at=now.isoformat(),
        )
        attempts.append(attempt)

    session.state = "finalized"
    session.finalized_at = now
    session.finish_reason = effective_finish_reason
    session.frozen_attempts = attempts
    session.version += 1

    evt = AssessmentEvent(
        session_id=session.id,
        owner_id=session.owner_id,
        kind="finalize",
        payload={
            "finish_reason": effective_finish_reason,
            "attempts_count": len(attempts),
        },
        created_at=now,
    )
    _oa_events.setdefault(session.id, []).append(evt)

    return True, session, attempts


def convert_oa_to_practice(
    session: OASessionRecord,
    reason: str = "Learner requested hints or coaching",
    server_now: Optional[datetime] = None,
) -> Tuple[bool, Optional[str], OASessionRecord]:
    """
    B18-AC3 & Failure to Prevent:
    Converts a strict OA session to coached practice:
    - Flags is_assisted = True.
    - Changes mode to SessionMode.PRACTICE.
    - Records conversion event with reason.
    - Preserves any already-frozen strict attempts from being tainted.
    - Prevents duplicate conversions.
    """
    now = server_now or datetime.now(timezone.utc)

    if session.is_assisted or session.mode == SessionMode.PRACTICE:
        return False, "INVALID_STATE: Session is already in assisted practice mode", session

    session.mode = SessionMode.PRACTICE
    session.is_assisted = True
    session.resource_policy.hints = True
    session.resource_policy.ai = True
    session.version += 1

    evt = AssessmentEvent(
        session_id=session.id,
        owner_id=session.owner_id,
        kind="conversion",
        payload={"reason": reason},
        created_at=now,
    )
    _oa_events.setdefault(session.id, []).append(evt)

    return True, None, session


def record_oa_interruption(
    session: OASessionRecord,
    reason: str = "Network or browser disconnection detected",
    server_now: Optional[datetime] = None,
) -> OASessionRecord:
    """
    B18: Interruption and outage are recorded honestly without resetting timers.
    """
    now = server_now or datetime.now(timezone.utc)
    session.is_interrupted = True
    session.version += 1

    evt = AssessmentEvent(
        session_id=session.id,
        owner_id=session.owner_id,
        kind="interruption",
        payload={"reason": reason},
        created_at=now,
    )
    _oa_events.setdefault(session.id, []).append(evt)
    return session
