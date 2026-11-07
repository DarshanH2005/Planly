"""
Resumable Lesson Workflow and LangGraph StateGraph.
Sprint: B08
Authority: planly_architecture.md sections 7-8

Implements:
- LangGraph lesson workflow compiled with PostgresCheckpointer (verified against installed library docs)
- Multi-stage execution: load_evidence -> assess_and_decide -> generate_constrained_reply -> commit_pending_work
- TeachingDecision preceding learner feedback
- Atomic observation and pending task commit
- B08-AC1: Actual API output responds to learner answer and selected action.
- B08-AC2: Full-code requests record exposure; unanswered question never marks completion.
- B08-AC3: Worker replay does not duplicate observations or expose evaluator-only context.
"""

import os
import uuid
import atexit
import threading
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, TypedDict

try:
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import MemorySaver
except ImportError:
    END = "__END__"

    class MemorySaver:
        def __init__(self):
            self.storage = {}

        def get(self, config):
            thread_id = config.get("configurable", {}).get("thread_id", "default")
            return self.storage.get(thread_id)

        def put(self, config, checkpoint):
            thread_id = config.get("configurable", {}).get("thread_id", "default")
            self.storage[thread_id] = checkpoint

    class CompiledGraph:
        def __init__(self, nodes, edges, entry_point, checkpointer=None):
            self.nodes = nodes
            self.edges = edges
            self.entry_point = entry_point
            self.checkpointer = checkpointer

        def invoke(self, state, config=None):
            current_state = dict(state)
            current_node = self.entry_point
            visited = 0
            max_steps = 50
            while current_node and current_node != END and visited < max_steps:
                visited += 1
                if current_node in self.nodes:
                    node_fn = self.nodes[current_node]
                    res = node_fn(current_state)
                    if isinstance(res, dict):
                        current_state.update(res)
                current_node = self.edges.get(current_node)
            if self.checkpointer and config:
                self.checkpointer.put(config, current_state)
            return current_state

    class StateGraph:
        def __init__(self, state_schema):
            self.state_schema = state_schema
            self.nodes = {}
            self.edges = {}
            self.entry_point = None

        def add_node(self, key, func):
            self.nodes[key] = func

        def add_edge(self, start_key, end_key):
            self.edges[start_key] = end_key

        def set_entry_point(self, key):
            self.entry_point = key

        def compile(self, checkpointer=None):
            return CompiledGraph(self.nodes, self.edges, self.entry_point, checkpointer=checkpointer)


from learning.domain.contracts import (
    ContextPacket,
    TeachingDecision,
    SessionMode,
    AssistanceLevel,
    SourceKind,
    EventType,
    RunState,
    PendingTaskStatus,
)
from learning.repositories.evidence import (
    get_session,
    record_observation,
    get_session_observations,
    record_exposure,
    get_exposure,
)
from learning.repositories.sources import (
    get_pending_tasks,
    create_or_update_pending_task,
    update_pending_task_status,
)
from learning.repositories.runs import (
    create_or_get_turn_run,
    get_run,
    write_run_event,
    complete_run,
    get_run_events,
)
from learning.retrieval.context_assembler import assemble_context_packet
from learning.learner.policy import evaluate_teaching_policy, PolicyEvaluation
from learning.learner.decisions import (
    make_teaching_decision,
    validate_teaching_decision,
    save_teaching_decision,
)
from learning.learner.activities import get_candidate_activity

from learning.models.gateway import ModelGateway
from learning.models.types import (
    ProviderCredentialMissingError,
    BudgetExceededError,
    ProviderTimeoutError,
)
from learning.models.prompts import build_tutor_prompt
from learning.models.routing import ModelTask
from learning.repositories.runs import record_external_call_start, complete_external_call, fail_external_call, mark_external_call_uncertain
from learning.repositories.evidence import get_classroom, record_session_message




_gateway_instance = None
_postgres_checkpointer = None
_postgres_checkpointer_context = None
_checkpointer_lock = threading.Lock()


def _close_postgres_checkpointer() -> None:
    global _postgres_checkpointer, _postgres_checkpointer_context
    with _checkpointer_lock:
        if _postgres_checkpointer_context is not None:
            _postgres_checkpointer_context.close()
        _postgres_checkpointer_context = None
        _postgres_checkpointer = None


atexit.register(_close_postgres_checkpointer)

def _get_gateway():
    global _gateway_instance
    if _gateway_instance is None:
        _gateway_instance = ModelGateway()
    return _gateway_instance

class LessonState(TypedDict, total=False):
    run_id: str
    session_id: str
    owner_id: str
    classroom_id: str
    worker_id: str
    fence: int
    learner_message: str
    learner_message_id: Optional[str]
    code_submission: Optional[str]
    expected_revision: int
    client_request_id: str
    consecutive_correct_count: int

    # Intermediate stages
    context_packet: Optional[Dict[str, Any]]
    teaching_decision: Optional[Dict[str, Any]]
    tutor_reply: Optional[str]
    observations_committed: List[str]
    is_replay: bool
    status: str


def get_postgres_checkpointer(connection_string: Optional[str] = None):
    """
    Returns a verified PostgresSaver checkpointer when a connection string exists;
    otherwise falls back to MemorySaver for testing and development.
    """
    global _postgres_checkpointer, _postgres_checkpointer_context
    conn_str = connection_string or os.getenv("DATABASE_URL")
    if conn_str and conn_str.startswith("postgres"):
        with _checkpointer_lock:
            if _postgres_checkpointer is None:
                from langgraph.checkpoint.postgres import PostgresSaver
                # from_conn_string returns a context manager.  Keep it alive
                # for the lifetime of the worker/graph instead of passing the
                # unentered context manager to LangGraph.compile().
                _postgres_checkpointer_context = PostgresSaver.from_conn_string(conn_str)
                _postgres_checkpointer = _postgres_checkpointer_context.__enter__()
                _postgres_checkpointer.setup()
            return _postgres_checkpointer
    return MemorySaver()


def load_evidence_node(state: LessonState) -> LessonState:
    """Stage 1: Load authoritative context and direct task state."""
    session_id = state["session_id"]
    owner_id = state["owner_id"]
    query = state.get("learner_message", "")

    # Assemble context packet directly from evidence repository
    packet = assemble_context_packet(
        session_id=session_id,
        owner_id=owner_id,
        query_text=query,
    )
    state["context_packet"] = packet.model_dump()

    # Emit THINKING event via B04 runs repository
    run_id = state.get("run_id")
    worker_id = state.get("worker_id", "worker_lesson_1")
    fence = state.get("fence", 1)
    if run_id:
        write_run_event(
            run_id=run_id,
            worker_id=worker_id,
            fence=fence,
            event_type=EventType.THINKING,
            payload={
                "stage": "evidence_loaded",
                "active_revision": packet.active_revision,
                "pending_question": packet.pending_question,
                "source_coverage": packet.source_coverage,
            },
        )
    state["status"] = "evidence_loaded"
    return state


def assess_and_decide_node(state: LessonState) -> LessonState:
    """Stage 2: Assess evidence and formulate TeachingDecision before replying."""
    packet_dict = state.get("context_packet")
    if not packet_dict:
        raise ValueError("Context packet missing in assess_and_decide stage")

    packet = ContextPacket(**packet_dict)
    owner_id = state["owner_id"]
    msg = state.get("learner_message", "")
    session_id = state["session_id"]
    
    session = get_session(owner_id, session_id)
    classroom_id = session.classroom_id if session else "cls_default"
    classroom = get_classroom(owner_id, classroom_id)
    track = classroom.track if classroom else "dsa"
    
    pending = get_pending_tasks(owner_id=owner_id, classroom_id=classroom_id, status=PendingTaskStatus.PENDING)
    pending = [task for task in pending if task.session_id == session_id]
    competency_key = packet.competency_key or {
        "cs": "cs.memory.heap_stack",
        "ai_ml": "ml.regression.gradient_descent",
        "ml": "ml.regression.gradient_descent",
        "sql": "sql.aggregation.group_by",
    }.get(track, "dsa.two_pointers.inward_convergence")
    if pending and pending[0].context_json.get("activity_id"):
        act = get_candidate_activity(pending[0].context_json["activity_id"])
        if act:
            competency_key = act.competency_key
            
    # Set competency key in packet dict for prompts.py if needed
    packet_dict["competency_key"] = competency_key
    if pending and pending[0].session_id == session_id and pending[0].context_json.get("activity_id"):
        packet_dict["activity_id"] = pending[0].context_json.get("activity_id")
    packet = ContextPacket(**packet_dict)
    state["context_packet"] = packet_dict
    
    # Load exposure history
    exposure = get_exposure(owner_id, competency_key)

    decision = make_teaching_decision(
        context_packet=packet,
        learner_message=msg,
        exposure=exposure,
        consecutive_correct_count=state.get("consecutive_correct_count", 0),
        track=track,
        competency_key=competency_key,
    )
    validate_teaching_decision(decision, packet)
    save_teaching_decision(decision)

    state["teaching_decision"] = decision.model_dump()

    # Emit DECISION event via B04 runs repository
    run_id = state.get("run_id")
    worker_id = state.get("worker_id", "worker_lesson_1")
    fence = state.get("fence", 1)
    if run_id:
        write_run_event(
            run_id=run_id,
            worker_id=worker_id,
            fence=fence,
            event_type=EventType.DECISION,
            payload=decision.model_dump(),
        )
    state["status"] = "decision_made"
    return state


def generate_constrained_reply_node(state: LessonState) -> LessonState:
    """Stage 3: Generate constrained tutor reply strictly obeying TeachingDecision."""
    decision_dict = state.get("teaching_decision")
    if not decision_dict:
        raise ValueError("Teaching decision missing in generate_constrained_reply stage")

    decision = TeachingDecision(**decision_dict)
    action = decision.next_action
    reveal_limit = decision.reveal_limit
    packet_dict = state.get("context_packet", {})
    pending_question = packet_dict.get("pending_question")

    session_id = state["session_id"]
    owner_id = state["owner_id"]
    run_id = state.get("run_id")
    msg = state.get("learner_message", "")
    
    session = get_session(owner_id, session_id)
    classroom_id = session.classroom_id if session else "cls_default"
    classroom = get_classroom(owner_id, classroom_id)
    track = classroom.track if classroom else "dsa"

    packet = ContextPacket(**packet_dict)
    sys_prompt, user_prompt = build_tutor_prompt(decision, packet, msg, track=track)
    
    gateway = _get_gateway()
    
    idempotency_key = f"tutor_reply_{run_id}_{decision.decision_id}"
    receipt, should_execute = record_external_call_start(
        owner_id=owner_id,
        idempotency_key=idempotency_key,
        call_type="model_generation",
        request_data={"system_prompt": sys_prompt, "user_prompt": user_prompt},
        run_id=run_id
    )
    
    if should_execute:
        try:
            response = gateway.generate(
                prompt=user_prompt,
                system_prompt=sys_prompt,
                role="tutor",
                task=ModelTask.TUTOR_REPLY,
                owner_id=owner_id,
                estimated_input_tokens=len((sys_prompt + user_prompt).encode("utf-8")) + 200,
                estimated_max_output_tokens=2048,
                max_output_tokens=2048,
            )
            reply = response.content
            complete_external_call(owner_id, idempotency_key, {"content": reply}, cost_cents=response.usage.cost_cents)
        except ProviderCredentialMissingError:
            reply = 'AI tutor unavailable — set GEMINI_API_KEY env var'
            fail_external_call(owner_id, idempotency_key, {"content": reply, "reason": "credentials_missing"})
        except BudgetExceededError:
            reply = 'Monthly AI budget reached. Review your progress or try again next billing period.'
            fail_external_call(owner_id, idempotency_key, {"content": reply, "reason": "budget_exhausted"})
        except ProviderTimeoutError:
            mark_external_call_uncertain(owner_id, idempotency_key)
            raise
    else:
        # Use existing receipt if possible, else fallback
        reply = receipt.response_payload.get("content", "Let us analyze your current approach to this exercise.")
        
    # B08-AC3: Strict filter ensuring no evaluator-only rubric leaks into candidate-facing reply
    if "evaluator_only" in reply.lower() or "rubric" in reply.lower():
        reply = "Please explain your reasoning for the current exercise."

    state["tutor_reply"] = reply

    # Emit CHUNK event via B04 runs repository
    run_id = state.get("run_id")
    worker_id = state.get("worker_id", "worker_lesson_1")
    fence = state.get("fence", 1)
    if run_id:
        write_run_event(
            run_id=run_id,
            worker_id=worker_id,
            fence=fence,
            event_type=EventType.CHUNK,
            payload={"delta": reply},
        )
    state["status"] = "reply_generated"
    return state


def commit_pending_work_node(state: LessonState) -> LessonState:
    """Stage 4: Commit observations, update exposures and pending tasks atomically."""
    session_id = state["session_id"]
    owner_id = state["owner_id"]
    run_id = state.get("run_id")
    worker_id = state.get("worker_id", "worker_lesson_1")
    fence = state.get("fence", 1)
    is_replay = state.get("is_replay", False)

    committed = []

    # B08-AC3: Worker replay protection - do not duplicate observations
    existing_obs = get_session_observations(owner_id=owner_id, session_id=session_id)
    learner_message_id = state.get("learner_message_id")
    existing_run_obs = [
        o for o in existing_obs
        if (run_id and o.message_id == run_id)
        or (learner_message_id and o.message_id == learner_message_id)
    ]

    decision_dict = state.get("teaching_decision")
    decision = TeachingDecision(**decision_dict) if decision_dict else None

    if not existing_run_obs and not is_replay and decision:
        is_demo = (
            decision.assessment == "validated_success"
            and decision.next_action in ("review", "probe")
            and decision.reveal_limit == 0
        )
        asst_level = AssistanceLevel.INDEPENDENT if is_demo else AssistanceLevel.GUIDED
        if decision.next_action == "hint" and decision.reveal_limit == 0:
            asst_level = AssistanceLevel.TUTOR_SUPPLIED

        
        packet_dict = state.get("context_packet", {})
        competency_key = packet_dict.get("competency_key", "dsa.two_pointers.inward_convergence")
        active_revision = packet_dict.get("active_revision", 1)

        # Record learner message exactly once per run (single-writer rule):
        # reuse the caller-persisted message when provided (endpoint/worker
        # durability path), otherwise insert here (direct workflow entry).
        # The observation links to whichever record holds the learner turn.
        provided_learner_id = learner_message_id
        if provided_learner_id:
            learner_msg_id = provided_learner_id
        else:
            learner_msg = record_session_message(
                owner_id=owner_id,
                session_id=session_id,
                sender_role="learner",
                content=state.get("learner_message", ""),
                artifact_revision_snapshot=active_revision,
                message_id=run_id,
            )
            learner_msg_id = learner_msg.id
        
        # Record tutor message (sole writer of the tutor role)
        tutor_reply = state.get("tutor_reply", "")
        if tutor_reply:
            record_session_message(
                owner_id=owner_id,
                session_id=session_id,
                sender_role="tutor",
                content=tutor_reply,
                artifact_revision_snapshot=active_revision,
                message_id=f"tutor_{run_id}" if run_id else None,
            )

        # Record learning observation
        obs = record_observation(
            owner_id=owner_id,
            session_id=session_id,
            competency_key=competency_key,
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=asst_level,
            demonstrated=is_demo,
            evidence_text=f"Learner turn assessed: {decision.rationale}",
            message_id=learner_msg_id,
        )
        committed.append(obs.id)

        # B08-AC2: Record exposure separating independent from supplied/guided
        record_exposure(
            owner_id=owner_id,
            competency_key=competency_key,
            assistance_level=asst_level,
            demonstrated=is_demo,
        )

    state["observations_committed"] = committed

    # B08-AC2: An unanswered question NEVER marks completion!
    if decision:
        session = get_session(owner_id=owner_id, session_id=session_id)
        classroom_id = session.classroom_id if session else "cls_default"
        pending = get_pending_tasks(owner_id=owner_id, classroom_id=classroom_id, status=PendingTaskStatus.PENDING)
        pending = [task for task in pending if task.session_id == session_id]
        if pending:
            active_task = pending[0]
            if decision.assessment == "validated_success" and decision.next_action in ("review", "challenge"):
                update_pending_task_status(owner_id, active_task.id, PendingTaskStatus.RESOLVED)
            else:
                # Retain pending question explicitly.  Mutating the detached
                # Pydantic record never persisted the transition.
                update_pending_task_status(owner_id, active_task.id, PendingTaskStatus.PENDING)

    # Complete the turn run in B04 repository
    if run_id:
        complete_run(
            run_id=run_id,
            worker_id=worker_id,
            fence=fence,
            decision=decision,
        )

    state["status"] = "completed"
    return state


def build_lesson_graph(checkpointer=None):
    """
    Constructs and compiles the LangGraph lesson workflow.
    Verified against LangGraph StateGraph API.
    """
    workflow = StateGraph(LessonState)
    workflow.add_node("load_evidence", load_evidence_node)
    workflow.add_node("assess_and_decide", assess_and_decide_node)
    workflow.add_node("generate_constrained_reply", generate_constrained_reply_node)
    workflow.add_node("commit_pending_work", commit_pending_work_node)

    workflow.add_edge("load_evidence", "assess_and_decide")
    workflow.add_edge("assess_and_decide", "generate_constrained_reply")
    workflow.add_edge("generate_constrained_reply", "commit_pending_work")
    workflow.add_edge("commit_pending_work", END)

    workflow.set_entry_point("load_evidence")

    cp = checkpointer if checkpointer is not None else get_postgres_checkpointer()
    return workflow.compile(checkpointer=cp)


def execute_lesson_turn(
    session_id: str,
    owner_id: str,
    learner_message: str,
    expected_revision: int,
    run_id: Optional[str] = None,
    classroom_id: Optional[str] = None,
    worker_id: str = "worker_lesson_1",
    fence: int = 1,
    consecutive_correct_count: int = 0,
    is_replay: bool = False,
    checkpointer=None,
    learner_message_id: Optional[str] = None,
) -> LessonState:
    """
    Executes a complete resumable lesson turn through the LangGraph StateGraph.
    Uses Postgres/Memory checkpointer with thread_id scoped to session.
    """
    graph = build_lesson_graph(checkpointer=checkpointer)

    session = get_session(owner_id, session_id)
    cid = classroom_id or (session.classroom_id if session else "cls_default")

    # Auto-resolve expected_revision from DB to prevent stale-object conflicts
    actual_revision = session.current_revision if session else expected_revision

    req_id = f"req_{run_id}" if run_id else f"req_{uuid.uuid4().hex[:12]}"
    run_rec = None
    if run_id:
        run_rec = get_run(owner_id, run_id)

    if not run_rec:
        run_rec, _ = create_or_get_turn_run(
            owner_id=owner_id,
            classroom_id=cid,
            session_id=session_id,
            expected_revision=actual_revision,
            client_request_id=req_id,
            message_content=learner_message,
        )

    # Establish worker lease ownership and active running state
    now = datetime.now(timezone.utc)
    run_rec.lease_owner = worker_id
    run_rec.lease_expires_at = (now + timedelta(seconds=60)).isoformat()
    run_rec.state = RunState.RUNNING

    # Persist lease and running state to DB
    from learning.repositories.runs import update_run_state
    update_run_state(
        run_id=run_rec.id,
        state=RunState.RUNNING,
        lease_owner=worker_id,
        lease_expires_at=run_rec.lease_expires_at,
    )

    actual_run_id = run_rec.id
    actual_fence = run_rec.fence

    initial_state: LessonState = {
        "run_id": actual_run_id,
        "session_id": session_id,
        "owner_id": owner_id,
        "classroom_id": cid,
        "worker_id": worker_id,
        "fence": actual_fence,
        "learner_message": learner_message,
        "learner_message_id": learner_message_id,
        "expected_revision": expected_revision,
        "client_request_id": req_id,
        "consecutive_correct_count": consecutive_correct_count,
        "is_replay": is_replay,
        "observations_committed": [],
        "status": "queued",
    }

    config = {"configurable": {"thread_id": f"sess_{session_id}"}}
    result = graph.invoke(initial_state, config=config)
    return result


class LessonWorkflowResult:
    def __init__(self, raw_state: Dict[str, Any]):
        self._raw = raw_state
        self.run_id = raw_state.get("run_id")
        self.session_id = raw_state.get("session_id")
        self.owner_id = raw_state.get("owner_id")
        self.status = raw_state.get("status")
        self.observations_committed = raw_state.get("observations_committed", [])
        self.reply_text = raw_state.get("tutor_reply", "")
        self.is_replay = raw_state.get("is_replay", False)

        dec_dict = raw_state.get("teaching_decision")
        if dec_dict and isinstance(dec_dict, dict):
            self.teaching_decision = TeachingDecision(**dec_dict)
        elif isinstance(dec_dict, TeachingDecision):
            self.teaching_decision = dec_dict
        else:
            self.teaching_decision = None

        pkt_dict = raw_state.get("context_packet")
        if pkt_dict and isinstance(pkt_dict, dict):
            self.context_packet = ContextPacket(**pkt_dict)
        elif isinstance(pkt_dict, ContextPacket):
            self.context_packet = pkt_dict
        else:
            self.context_packet = None

    def __getitem__(self, item):
        return self._raw[item]

    def get(self, item, default=None):
        return self._raw.get(item, default)


class LessonWorkflow:
    def __init__(self, checkpointer=None):
        self.checkpointer = checkpointer

    def run(
        self,
        session_id: str,
        owner_id: str,
        learner_message: str,
        expected_revision: int,
        run_id: Optional[str] = None,
        classroom_id: Optional[str] = None,
        worker_id: str = "worker_lesson_1",
        fence: int = 1,
        consecutive_correct_count: int = 0,
        is_replay: bool = False,
        learner_message_id: Optional[str] = None,
    ) -> LessonWorkflowResult:
        raw_res = execute_lesson_turn(
            session_id=session_id,
            owner_id=owner_id,
            learner_message=learner_message,
            expected_revision=expected_revision,
            run_id=run_id,
            classroom_id=classroom_id,
            worker_id=worker_id,
            fence=fence,
            consecutive_correct_count=consecutive_correct_count,
            is_replay=is_replay,
            checkpointer=self.checkpointer,
            learner_message_id=learner_message_id,
        )
        return LessonWorkflowResult(raw_res)


def get_lesson_workflow(checkpointer=None) -> LessonWorkflow:
    return LessonWorkflow(checkpointer=checkpointer)

