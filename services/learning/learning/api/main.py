from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

# Load services/learning/.env before any provider reads the environment,
# so GEMINI_API_KEY (and later model/budget settings) work with a plain
# file drop + server restart. Explicit process env still wins.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.api.runs import router as runs_router
from learning.api.sources import router as sources_router
from learning.api.plans import router as plans_router
from learning.api.assessments import router as assessments_router
from learning.api.progress import router as progress_router
from learning.api.privacy import router as privacy_router
from learning.api.exports import router as exports_router
from learning.api.media import router as media_router
from learning.api.model_routing import router as model_routing_router
from learning.api.provider_credentials import router as provider_credentials_router
from learning.models.types import BudgetStatusReport
from learning.models.budget import get_budget_tracker
from learning.retrieval.context_assembler import assemble_context_packet
from learning.domain.contracts import (
    ContextPacket,
    TeachingDecision,
    RunReceipt,
    LearningObservation,
    ArtifactRecord,
    AttemptRecord,
    ModeRecord,
    ExposureRecord,
    LessonMicroGoal,
    ActivityDefinition,
    ClassroomRecord,
    SessionRecord,
    MessageRecord,
    ErrorEnvelope,
    SourceKind,
    AssistanceLevel,
    SessionMode,
    SessionStage,
    ExecutionRecord,
    ExecutionRequestInput,
    ExecutionResponse,
)
from learning.repositories.evidence import (
    save_artifact,
    get_artifact,
    record_attempt,
    get_session_attempts,
    record_observation,
    get_session_observations,
    create_classroom,
    get_classroom,
    list_classrooms,
    create_session,
    get_session,
    list_sessions,
    record_session_message,
    get_session_messages,
    complete_lesson_session,
    get_lesson_handoffs,
    create_micro_goal,
    update_micro_goal,
    get_session_micro_goals,
    StaleArtifactWriteError,
    CrossOwnerReferenceError,
    DanglingReferenceError,
)
from learning.repositories.executions import (
    get_execution,
    list_session_executions,
)
from learning.learner.decisions import get_session_decisions
from learning.learner.activities import get_candidate_activity, activity_for_topic, activity_for_session
from learning.workflows.lesson import execute_lesson_turn
from learning.workflows.evaluate import evaluate_session_code
from learning.workflows.coach import respond as respond_to_coach, memory_records, save_recommendation, get_recommendation, memory_checkpoint, persist_memory, open_agreed_lesson, dismiss_recommendation
from learning.models.types import ModelGatewayError


app = FastAPI(
    title="Planly Learning API",
    description="Adaptive interview tutor, durable worker, and learning evaluation service",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# Permit local Next.js frontend calls in development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class OwnerResponse(BaseModel):
    owner_id: str
    email: Optional[str] = None
    role: str
    authorized: bool = True


class ClassroomInput(BaseModel):
    id: Optional[str] = None
    track: str
    title: str


class SessionCreateInput(BaseModel):
    id: Optional[str] = None
    stage: SessionStage = SessionStage.FOUNDATION
    mode: SessionMode = SessionMode.PRACTICE
    parent_session_id: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=160)


class LessonHandoffInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    status: str = Field(default="checkpoint", max_length=40)
    summary: str = Field(min_length=1, max_length=3000)
    demonstrated_skills: List[str] = Field(default_factory=list, max_length=12)
    misconceptions: List[str] = Field(default_factory=list, max_length=12)
    next_recommendation: Optional[str] = Field(default=None, max_length=500)


class CoachMessageInput(BaseModel):
    content: str = Field(min_length=1, max_length=3000)


class MessageInput(BaseModel):
    content: str
    expected_revision: int = Field(ge=1)



class ArtifactInput(BaseModel):
    content: str
    expected_revision: int = Field(ge=1)
    language: str = "python"


class AttemptInput(BaseModel):
    source_revision: int = Field(ge=1)
    assistance_level: AssistanceLevel
    artifact_id: Optional[str] = None
    frozen_code: str = ""
    frozen_language: str = "python"
    elapsed_seconds: Optional[int] = Field(default=None, ge=0)
    mode: SessionMode = SessionMode.PRACTICE
    exposure_state: Dict[str, Any] = Field(default_factory=dict)


class ObservationInput(BaseModel):
    competency_key: str
    source_kind: SourceKind
    assistance_level: AssistanceLevel
    demonstrated: bool = False
    evidence_text: str
    message_id: Optional[str] = None
    artifact_id: Optional[str] = None
    attempt_id: Optional[str] = None


class MicroGoalInput(BaseModel):
    description: str
    competency_key: str
    is_editable: bool = True


class MicroGoalUpdateInput(BaseModel):
    description: Optional[str] = None
    status: Optional[str] = None


class LessonTurnInput(BaseModel):
    message: str
    expected_revision: int = Field(ge=1)
    run_id: Optional[str] = None
    consecutive_correct_count: int = 0


class LessonTurnResponse(BaseModel):
    run_id: str
    session_id: str
    reply: str
    teaching_decision: TeachingDecision
    observations_committed: List[str]
    status: str


class ClassroomInput(BaseModel):
    id: Optional[str] = None
    track: str = "dsa"
    title: str = "DSA: Inward Convergence (Two Sum)"


class SessionInput(BaseModel):
    stage: SessionStage = SessionStage.FOUNDATION
    mode: SessionMode = SessionMode.LEARN




@app.get("/api/health", response_model=HealthResponse, tags=["System"])
async def get_health() -> HealthResponse:
    """
    Canonical system health endpoint.
    Verified by B01-AC2.
    """
    return HealthResponse(
        status="ok",
        service="learning",
        version="0.1.0",
    )


@app.get("/api/auth/me", response_model=OwnerResponse, tags=["Identity"])
async def get_current_user_profile(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> OwnerResponse:
    """
    Protected owner endpoint verifying token validity and private-owner authorization.
    Verified by B02-AC2 and B02-AC3.
    """
    return OwnerResponse(
        owner_id=owner.owner_id,
        email=owner.email,
        role=owner.role,
        authorized=True,
    )


@app.put(
    "/api/sessions/{session_id}/artifact",
    response_model=ArtifactRecord,
    responses={
        status.HTTP_409_CONFLICT: {"model": ErrorEnvelope},
        status.HTTP_404_NOT_FOUND: {"model": ErrorEnvelope},
    },
    tags=["Classroom"],
)
async def put_session_artifact(
    session_id: str,
    body: ArtifactInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ArtifactRecord:
    """
    Updates code artifact. Rejects stale writes when expected_revision != current_revision.
    """
    try:
        return save_artifact(
            owner_id=owner.owner_id,
            session_id=session_id,
            expected_revision=body.expected_revision,
            content=body.content,
            language=body.language,
        )
    except StaleArtifactWriteError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Stale artifact write: expected {e.expected_revision}, current {e.current_revision}",
        )
    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.get(
    "/api/sessions/{session_id}/artifact",
    response_model=Optional[ArtifactRecord],
    tags=["Classroom"],
)
async def get_session_artifact_endpoint(
    session_id: str,
    revision: Optional[int] = None,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Optional[ArtifactRecord]:
    """
    Retrieves the latest or specified artifact revision for a session.
    """
    sess = get_session(owner.owner_id, session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session '{session_id}' not found")
    return get_artifact(owner.owner_id, session_id, revision)


@app.get(
    "/api/sessions/{session_id}/messages",
    response_model=List[MessageRecord],
    tags=["Classroom"],
)
async def get_session_messages_endpoint(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[MessageRecord]:
    """
    Returns message history for a session to restore state on reload.
    """
    sess = get_session(owner.owner_id, session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session '{session_id}' not found")
    return get_session_messages(owner.owner_id, session_id)


@app.get("/api/classrooms", response_model=List[ClassroomRecord], tags=["Classrooms"])
async def get_classrooms(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[ClassroomRecord]:
    """Lists all classrooms for the authenticated owner."""
    return list_classrooms(owner.owner_id)


@app.post(
    "/api/classrooms",
    response_model=ClassroomRecord,
    status_code=status.HTTP_201_CREATED,
    tags=["Classrooms"],
)
async def post_classroom(
    body: ClassroomInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ClassroomRecord:
    """Creates a new classroom."""
    return create_classroom(owner.owner_id, body.track, body.title, body.id)


@app.get("/api/classrooms/{classroom_id}", response_model=ClassroomRecord, tags=["Classrooms"])
async def get_single_classroom(
    classroom_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ClassroomRecord:
    """Retrieves a specific classroom."""
    cls_rec = get_classroom(owner.owner_id, classroom_id)
    if not cls_rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Classroom '{classroom_id}' not found")
    return cls_rec


@app.get("/api/classrooms/{classroom_id}/sessions", response_model=List[SessionRecord], tags=["Classrooms"])
async def get_classroom_sessions(
    classroom_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[SessionRecord]:
    """Lists all sessions belonging to a classroom."""
    cls_rec = get_classroom(owner.owner_id, classroom_id)
    if not cls_rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Classroom '{classroom_id}' not found")
    return list_sessions(owner.owner_id, classroom_id)


@app.post(
    "/api/classrooms/{classroom_id}/sessions",
    response_model=SessionRecord,
    status_code=status.HTTP_201_CREATED,
    tags=["Classrooms"],
)
async def post_classroom_session(
    classroom_id: str,
    body: SessionCreateInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> SessionRecord:
    """Creates a new session in a classroom."""
    try:
        return create_session(owner.owner_id, classroom_id, body.stage.value, body.mode.value, body.id, body.parent_session_id, body.title)
    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.get("/api/sessions/{session_id}", response_model=SessionRecord, tags=["Classroom"])
async def get_single_session(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> SessionRecord:
    """Retrieves a specific session."""
    sess = get_session(owner.owner_id, session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session '{session_id}' not found")
    return sess


@app.get("/api/sessions/{session_id}/handoffs", tags=["Coach"])
async def get_child_lesson_handoffs(session_id: str, owner: AuthenticatedOwner = Depends(get_current_owner)) -> List[Dict[str, Any]]:
    if not get_session(owner.owner_id, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session '{session_id}' not found")
    return get_lesson_handoffs(owner.owner_id, session_id)


@app.post("/api/sessions/{session_id}/complete", tags=["Coach"])
async def return_lesson_to_coach(session_id: str, body: LessonHandoffInput, owner: AuthenticatedOwner = Depends(get_current_owner)) -> Dict[str, Any]:
    try:
        return complete_lesson_session(owner.owner_id, session_id, body.title, body.status, body.summary, body.demonstrated_skills, body.misconceptions, body.next_recommendation)
    except DanglingReferenceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/sessions/{session_id}/coach-message", response_model=List[MessageRecord], tags=["Coach"], deprecated=True)
def legacy_post_coach_message(session_id: str, body: CoachMessageInput, owner: AuthenticatedOwner = Depends(get_current_owner)) -> List[MessageRecord]:
    """Durable main-chat planning turn; it never starts a teaching run."""
    return post_coach_turn(session_id, body, owner)["messages"]


@app.get("/api/coach/memory", tags=["Coach"])
def get_coach_memory(owner: AuthenticatedOwner = Depends(get_current_owner)) -> List[Dict[str, Any]]:
    return memory_records(owner.owner_id)


@app.get("/api/coach/activity", response_model=ActivityDefinition, tags=["Coach"])
def get_topic_activity(topic: str, owner: AuthenticatedOwner = Depends(get_current_owner)):
    activity = activity_for_topic(topic)
    if not activity:
        raise HTTPException(status_code=404, detail="No reviewed exercise is available for this topic yet. Continue with your Coach.")
    return activity


@app.post("/api/sessions/{session_id}/open-lesson", response_model=SessionRecord, tags=["Coach"])
def open_coach_lesson(session_id: str, body: CoachMessageInput, owner: AuthenticatedOwner = Depends(get_current_owner)):
    try:
        return open_agreed_lesson(owner.owner_id, session_id, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/api/sessions/{session_id}/activity", response_model=ActivityDefinition, tags=["Coach"])
def get_selected_session_activity(session_id: str, owner: AuthenticatedOwner = Depends(get_current_owner)):
    if not get_session(owner.owner_id, session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    activity = activity_for_session(owner.owner_id, session_id)
    if not activity:
        raise HTTPException(status_code=404, detail="No reviewed exercise is selected for this lesson")
    return activity


@app.post("/api/sessions/{session_id}/coach-turn", tags=["Coach"])
def post_coach_turn(session_id: str, body: CoachMessageInput, owner: AuthenticatedOwner = Depends(get_current_owner)) -> Dict[str, Any]:
    session = get_session(owner.owner_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Coach session not found")
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Enter a message")
    try:
        checkpoint = memory_checkpoint(owner.owner_id, session_id)
        answer = respond_to_coach(owner.owner_id, session_id, body.content)
    except ModelGatewayError:
        # Never disguise provider failure as a fabricated learning plan.
        raise HTTPException(status_code=503, detail="The Coach could not finish this response. Check model availability and API settings, then retry. Your message has not been saved.")
    learner = record_session_message(owner.owner_id, session_id, "learner", body.content, session.current_revision)
    reply = record_session_message(owner.owner_id, session_id, "tutor", answer.reply, session.current_revision)
    save_recommendation(owner.owner_id, session_id, reply.id, answer.recommended_lesson)
    if checkpoint["turns_to_compact"]:
        persist_memory(owner.owner_id, session_id, answer.memory_update, checkpoint["covered_messages"])
    return {"messages": [learner, reply], "recommended_lesson": answer.recommended_lesson}


@app.get("/api/sessions/{session_id}/coach-recommendation", tags=["Coach"])
def get_coach_recommendation(session_id: str, owner: AuthenticatedOwner = Depends(get_current_owner)) -> Dict[str, Any]:
    if not get_session(owner.owner_id, session_id):
        raise HTTPException(status_code=404, detail="Coach session not found")
    return {"recommended_lesson": get_recommendation(owner.owner_id, session_id)}


@app.delete("/api/sessions/{session_id}/coach-recommendation", tags=["Coach"])
def dismiss_coach_proposal(session_id: str, owner: AuthenticatedOwner = Depends(get_current_owner)):
    if not get_session(owner.owner_id, session_id):
        raise HTTPException(status_code=404, detail="Coach session not found")
    dismiss_recommendation(owner.owner_id, session_id)
    return {"recommended_lesson": None}


@app.post(
    "/api/sessions/{session_id}/attempts",
    response_model=AttemptRecord,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_404_NOT_FOUND: {"model": ErrorEnvelope},
    },
    tags=["Classroom"],
)
async def post_session_attempt(
    session_id: str,
    body: AttemptInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> AttemptRecord:
    """
    Records an immutable attempt / frozen submission.
    """
    try:
        return record_attempt(
            owner_id=owner.owner_id,
            session_id=session_id,
            source_revision=body.source_revision,
            assistance_level=body.assistance_level,
            artifact_id=body.artifact_id,
            frozen_code=body.frozen_code,
            frozen_language=body.frozen_language,
            elapsed_seconds=body.elapsed_seconds,
            mode=body.mode,
            exposure_state=body.exposure_state,
        )
    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.get(
    "/api/sessions/{session_id}/attempts",
    response_model=List[AttemptRecord],
    tags=["Classroom"],
)
async def get_attempts(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[AttemptRecord]:
    """
    Returns all attempts for a session.
    """
    return get_session_attempts(owner_id=owner.owner_id, session_id=session_id)


@app.post(
    "/api/sessions/{session_id}/observations",
    response_model=LearningObservation,
    status_code=status.HTTP_201_CREATED,
    responses={
        422: {"model": ErrorEnvelope},
        status.HTTP_404_NOT_FOUND: {"model": ErrorEnvelope},
    },
    tags=["Evidence"],
)
async def post_learning_observation(
    session_id: str,
    body: ObservationInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> LearningObservation:
    """
    Records immutable learning observation. Enforces B03-AC2 invariant.
    """
    try:
        return record_observation(
            owner_id=owner.owner_id,
            session_id=session_id,
            competency_key=body.competency_key,
            source_kind=body.source_kind,
            assistance_level=body.assistance_level,
            demonstrated=body.demonstrated,
            evidence_text=body.evidence_text,
            message_id=body.message_id,
            artifact_id=body.artifact_id,
            attempt_id=body.attempt_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.get(
    "/api/sessions/{session_id}/observations",
    response_model=List[LearningObservation],
    tags=["Evidence"],
)
async def get_observations(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[LearningObservation]:
    """
    Returns all learning observations for a session.
    """
    return get_session_observations(owner_id=owner.owner_id, session_id=session_id)


@app.get(
    "/api/sessions/{session_id}/context",
    response_model=ContextPacket,
    tags=["Classroom"],
)
async def get_session_context(
    session_id: str,
    query: Optional[str] = None,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ContextPacket:
    """
    Returns authoritative ContextPacket for teaching decisions using hybrid retrieval and explicit learning links.
    Verified by B07-AC1, B07-AC2, and B07-AC3.
    """
    return assemble_context_packet(
        session_id=session_id,
        owner_id=owner.owner_id,
        query_text=query or "",
    )


@app.get("/api/budget", response_model=BudgetStatusReport, tags=["Budget & Accounting"])
async def get_budget_status(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> BudgetStatusReport:
    """
    Returns real-time budget status across pools under the shared monthly ceiling.
    Enforces OPERATING_PROFILE.md limits.
    Verified by B06-AC4.
    """
    tracker = get_budget_tracker()
    return tracker.get_budget_status()


@app.get(
    "/api/sessions/{session_id}/decisions",
    response_model=List[TeachingDecision],
    tags=["Classroom"],
)
async def get_decisions(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[TeachingDecision]:
    """
    Returns all teaching decisions formulated for this session.
    """
    return get_session_decisions(owner_id=owner.owner_id, session_id=session_id)


@app.get(
    "/api/sessions/{session_id}/micro-goals",
    response_model=List[LessonMicroGoal],
    tags=["Classroom"],
)
async def get_micro_goals(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[LessonMicroGoal]:
    """
    Returns active and completed micro-goals for the session.
    """
    return get_session_micro_goals(owner_id=owner.owner_id, session_id=session_id)


@app.post(
    "/api/sessions/{session_id}/micro-goals",
    response_model=LessonMicroGoal,
    status_code=status.HTTP_201_CREATED,
    tags=["Classroom"],
)
async def post_micro_goal(
    session_id: str,
    body: MicroGoalInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> LessonMicroGoal:
    """
    Creates an editable lesson micro-goal.
    """
    try:
        return create_micro_goal(
            owner_id=owner.owner_id,
            session_id=session_id,
            description=body.description,
            competency_key=body.competency_key,
            is_editable=body.is_editable,
        )
    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.put(
    "/api/sessions/{session_id}/micro-goals/{goal_id}",
    response_model=LessonMicroGoal,
    tags=["Classroom"],
)
async def put_micro_goal(
    session_id: str,
    goal_id: str,
    body: MicroGoalUpdateInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> LessonMicroGoal:
    """
    Updates an editable lesson micro-goal description or status.
    """
    try:
        updated = update_micro_goal(
            owner_id=owner.owner_id,
            session_id=session_id,
            goal_id=goal_id,
            description=body.description,
            status=body.status,
        )
        if not updated:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Micro-goal not found")
        return updated
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@app.get(
    "/api/activities/{activity_id}",
    response_model=ActivityDefinition,
    tags=["Curriculum"],
)
async def get_activity(
    activity_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ActivityDefinition:
    """
    Returns candidate-facing activity definition, strictly stripping evaluator-only context (B08-AC3).
    """
    activity = get_candidate_activity(activity_id)
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Activity '{activity_id}' not found")
    return activity


@app.post(
    "/api/sessions/{session_id}/lesson-turn",
    response_model=LessonTurnResponse,
    tags=["Classroom"],
)
async def post_lesson_turn(
    session_id: str,
    body: LessonTurnInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> LessonTurnResponse:
    """
    Executes a complete adaptive lesson turn through the LangGraph StateGraph workflow.
    Verified by B08-AC1, B08-AC2, and B08-AC3.
    """
    result = execute_lesson_turn(
        session_id=session_id,
        owner_id=owner.owner_id,
        learner_message=body.message,
        expected_revision=body.expected_revision,
        run_id=body.run_id,
        consecutive_correct_count=body.consecutive_correct_count,
    )
    tutor_reply = result.get("tutor_reply", "")
    dec_dict = result.get("teaching_decision", {})
    return LessonTurnResponse(
        run_id=result.get("run_id", ""),
        session_id=session_id,
        reply=tutor_reply,
        teaching_decision=TeachingDecision(**dec_dict),
        observations_committed=result.get("observations_committed", []),
        status=result.get("status", "completed"),
    )


# --- Sprint B10: Execution Endpoints ---

@app.post(
    "/api/sessions/{session_id}/execute",
    response_model=ExecutionResponse,
    tags=["Execution"],
)
async def post_session_execute(
    session_id: str,
    body: Optional[ExecutionRequestInput] = None,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ExecutionResponse:
    """
    Executes learner Python code against test suite with strict bounds and out-of-band result extraction.
    Verified by B10-AC1, B10-AC2, and B10-AC3.
    """
    input_data = body or ExecutionRequestInput()
    try:
        return evaluate_session_code(
            owner_id=owner.owner_id,
            session_id=session_id,
            revision=input_data.revision,
            test_suite_id=input_data.test_suite_id,
            code_override=input_data.code_override,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@app.get(
    "/api/sessions/{session_id}/executions",
    response_model=List[ExecutionRecord],
    tags=["Execution"],
)
async def get_session_executions_endpoint(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[ExecutionRecord]:
    """
    Returns all execution evidence records for a session.
    """
    sess = get_session(owner.owner_id, session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Session '{session_id}' not found")
    return list_session_executions(owner.owner_id, session_id)


@app.get(
    "/api/sessions/{session_id}/executions/{execution_id}",
    response_model=ExecutionRecord,
    tags=["Execution"],
)
async def get_single_execution_endpoint(
    session_id: str,
    execution_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ExecutionRecord:
    """
    Retrieves a specific execution record.
    """
    rec = get_execution(owner.owner_id, execution_id)
    if not rec or rec.session_id != session_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Execution '{execution_id}' not found")
    return rec


# Mount B04 Durable Runs & Worker Queue Router
app.include_router(runs_router)

# Mount B05 Sources & Ingestion Router
app.include_router(sources_router)

# Mount B13 Plans Router
app.include_router(plans_router)

# Mount B18 Strict OA Assessments Router
app.include_router(assessments_router)

# Mount B21 Evidence-Based Progress & Debrief Router
app.include_router(progress_router)

# Mount B22 Privacy, Memory Corrections, and Deletion Router
app.include_router(privacy_router)

# Mount B23 Populated Backup and Verified Restore Router
app.include_router(exports_router)

# Mount B27 Optional Source Connectors & Voice Router
app.include_router(media_router)
app.include_router(model_routing_router)
app.include_router(provider_credentials_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("learning.api.main:app", host="0.0.0.0", port=8000, reload=True)
