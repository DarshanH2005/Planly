"""
Reviewed Activity Catalog for B08.
Sprint: B08
Authority: planly_architecture.md sections 7-8

Provides reviewed activities for the first DSA lesson (Two Sum / Inward Convergence Invariant).
Guarantees evaluator-only context is stripped for candidate-facing queries (B08-AC3).
"""

from pathlib import Path
import json
import re
from typing import Dict, Optional, Any, List
from learning.config import parse_simple_yaml
from learning.domain.contracts import ActivityDefinition

REPO_ROOT = Path(__file__).resolve().parents[4]
ACTIVITIES_DIR = REPO_ROOT / "config" / "prompts" / "activities"
CONTENT_ROOT = Path(__file__).resolve().parents[1] / "content"

_activities_cache: Dict[str, Dict[str, Any]] = {}


def _load_yaml_file(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    return parse_simple_yaml(text)


def get_activity_definition(activity_id: str = "act_dsa_two_sum_sorted") -> Optional[ActivityDefinition]:
    """Loads and caches activity definition."""
    if activity_id not in _activities_cache:
        file_path = None
        # The reviewed catalog contains activity-specific candidate/evaluator
        # projections for each supported subject. Resolve by id instead of
        # returning the DSA fixture for every classroom.
        for candidate in CONTENT_ROOT.glob("**/activities/*.json"):
            if json.loads(candidate.read_text(encoding="utf-8")).get("id") == activity_id:
                file_path = candidate
                break
        if file_path is None and activity_id == "act_dsa_two_sum_sorted":
            file_path = ACTIVITIES_DIR / "dsa_two_sum.yaml"
        if file_path is None or not file_path.exists():
            return None
        data = json.loads(file_path.read_text(encoding="utf-8")) if file_path.suffix == ".json" else _load_yaml_file(file_path)
        _activities_cache[activity_id] = data

    data = _activities_cache.get(activity_id)
    if not data:
        return None

    candidate = data.get("candidate", {})
    demands = data.get("demands", {})
    competency_key = data.get("competency_key") or data.get("micro_skill_id") or "unknown"
    if data.get("track") == "cs" and str(competency_key).startswith("cs.os"):
        competency_key = "cs.memory.heap_stack" if "process" in data["id"] or "memory" in data["id"] else "cs.concurrency.race_conditions"
    if data.get("track") == "ai_ml" and str(competency_key).startswith("ml."):
        competency_key = "ml.regression.gradient_descent"
    statement = data.get("statement") or candidate.get("statement") or data.get("description") or data.get("title", "")
    examples = data.get("examples") or candidate.get("examples") or []
    if not examples and data.get("dataset"):
        examples = [{"input": data["dataset"]}]
    evaluator = data.get("evaluator") or data.get("evaluator_context")
    micro_goal = data.get("micro_goal") or data.get("micro_skill_id") or data.get("title", "")
    return ActivityDefinition(
        id=data["id"],
        track=data["track"],
        title=data["title"],
        competency_key=competency_key,
        prerequisites=data.get("prerequisites", []),
        micro_goal=micro_goal,
        statement=statement,
        examples=examples,
        reference_checks=data.get("reference_checks") or [
            {"constraint": item} for item in candidate.get("constraints", [])
        ],
        evaluator_context=evaluator,
        visibility="candidate_facing",
        starter_code=candidate.get("starter_code", ""),
    )


def get_candidate_activity(activity_id: str = "act_dsa_two_sum_sorted") -> Optional[ActivityDefinition]:
    """
    B08-AC3: Returns candidate-facing activity projection.
    Strictly strips evaluator_context (hidden_solution and rubric).
    """
    activity = get_activity_definition(activity_id)
    if not activity:
        return None
    # Never mutate the cached evaluator record: a candidate request must not
    # permanently strip hidden rubric data from the evaluator projection.
    return activity.model_copy(update={
        "evaluator_context": None,
        "visibility": "candidate_facing",
    })


def get_evaluator_activity(activity_id: str = "act_dsa_two_sum_sorted") -> Optional[ActivityDefinition]:
    """
    Returns evaluator projection containing hidden solution and rubric.
    Never exposed to candidate routes.
    """
    return get_activity_definition(activity_id)


def activity_for_topic(topic: str) -> Optional[ActivityDefinition]:
    """Resolve only recognized topics; unsupported topics never become Two Sum."""
    normalized = re.sub(r"[^a-z0-9]+", " ", topic.lower()).strip()
    aliases = [
        (("longest consecutive", "consecutive sequence", "sequence start"), "act_dsa_longest_consecutive"),
        (("subarray sum", "prefix sum"), "act_dsa_subarray_sum_equals_k"),
        (("hash map two sum", "two sum hash", "two sum with hash"), "act_dsa_two_sum_hash_map"),
        (("two pointers", "two pointer", "two sum ii", "inward convergence", "two sum sorted"), "act_dsa_two_sum_sorted"),
        (("process", "thread"), "cs_process_vs_thread"),
        (("race condition",), "cs_race_condition_counter"),
        (("linear regression", "gradient descent"), "ml_numpy_linear_regression"),
    ]
    for phrases, activity_id in aliases:
        if any(phrase in normalized for phrase in phrases):
            return get_candidate_activity(activity_id)
    return get_candidate_activity(topic) if re.fullmatch(r"[a-z0-9_]+", topic) else None


def activity_for_session(owner_id: str, session_id: str) -> Optional[ActivityDefinition]:
    from learning.repositories.evidence import get_session, get_classroom
    from learning.repositories.sources import get_pending_tasks
    from learning.domain.contracts import PendingTaskStatus
    session = get_session(owner_id, session_id)
    if not session:
        return None
    pending = get_pending_tasks(owner_id, classroom_id=session.classroom_id, status=PendingTaskStatus.PENDING)
    for task in pending:
        if task.session_id == session_id and task.context_json.get("activity_id"):
            return get_candidate_activity(task.context_json["activity_id"])
    classroom = get_classroom(owner_id, session.classroom_id)
    selected = activity_for_topic(session.title or (classroom.title if classroom else ""))
    if selected or session.parent_session_id:
        return selected
    default_id = {"cs": "cs_process_vs_thread", "ai_ml": "ml_numpy_linear_regression"}.get(classroom.track if classroom else "dsa", "act_dsa_two_sum_sorted")
    return get_candidate_activity(default_id)
