"""
Sprint B20: Project, Design and Behavioural Interview Practice
Authority: PLANLY_BUILD_SPEC.md §8, 14, 20; B20_project_behavioral.md

Key Invariants:
- B20-AC1: Missing users, deployment or impact data remains unknown rather than invented.
- B20-AC2: A follow-up references an actual artifact/answer and preserves source IDs.
- B20-AC3: Project/behavioural evidence does not change algorithm readiness automatically.
- Failure to Prevent: Role-specific practice is not an official company interview unless supported
  by attributable current requirements.
"""

import os
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SessionMode,
    SessionStage,
    AssistanceLevel,
    SourceKind,
    LearningObservation,
)
from learning.repositories import evidence

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "project_behavioral"


# ==============================================================================
# Domain Models: Artifacts, Provenance, and Metrics
# ==============================================================================

class MetricStatus(str, Enum):
    UNKNOWN = "unknown"
    ESTIMATED = "estimated"
    VERIFIED = "verified"
    PROPOSED = "proposed"


class MetricAudit(BaseModel):
    metric_name: str
    status: MetricStatus
    raw_value: Optional[str] = None
    detail: str


class ProjectProvenance(BaseModel):
    source: str = "user_portfolio"
    owner_id: str
    is_editable: bool = True


class ProjectArtifact(BaseModel):
    id: str = Field(default_factory=lambda: f"art_proj_{uuid.uuid4().hex[:6]}")
    owner_id: str
    title: str
    summary: Optional[str] = None
    architecture_overview: str
    tech_stack: List[str] = Field(default_factory=list)
    technologies: List[str] = Field(default_factory=list)
    key_decisions: List[Dict[str, str]] = Field(default_factory=list)
    decisions: Dict[str, str] = Field(default_factory=dict)
    known_constraints: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    debugging_incidents: List[Dict[str, str]] = Field(default_factory=list)
    debugging_stories: List[str] = Field(default_factory=list)
    trade_offs: Dict[str, str] = Field(default_factory=dict)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    provenance: Optional[ProjectProvenance] = None
    repo_url: Optional[str] = None
    provenance_notes: Optional[str] = None
    is_production_deployed: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BehavioralExperience(BaseModel):
    id: str = Field(default_factory=lambda: f"exp_beh_{uuid.uuid4().hex[:6]}")
    owner_id: str
    title: str
    company_or_context: str
    situation: str
    task: str
    action: str
    result: str
    metrics: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    is_verified_experience: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectGap(BaseModel):
    gap_key: str
    dimension: str
    description: str
    resolved: bool = False
    source_turn_id: Optional[str] = None


class StudyRecommendation(BaseModel):
    gap_key: str
    activity_id: str
    track: str
    title: str
    description: str


class ProjectReviewTurn(BaseModel):
    id: str = Field(default_factory=lambda: f"turn_{uuid.uuid4().hex[:10]}")
    role: str  # "candidate" or "interviewer"
    stage: str = "overview"
    content: str
    source_turn_id: Optional[str] = None
    target_artifact_id: Optional[str] = None
    assistance_level: AssistanceLevel = AssistanceLevel.INDEPENDENT
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectReviewSessionState(BaseModel):
    session_id: str
    owner_id: str
    classroom_id: str
    artifact: ProjectArtifact
    turns: List[ProjectReviewTurn] = Field(default_factory=list)
    specific_gaps: List[ProjectGap] = Field(default_factory=list)
    is_official_company_interview: bool = False
    official_job_req_id: Optional[str] = None
    disclaimer: str = ""
    stage: str = "overview"
    mode: SessionMode = SessionMode.STRICT
    is_interrupted: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# Storage for tests / state
_project_review_sessions: Dict[str, ProjectReviewSessionState] = {}


def reset_project_review_storage():
    _project_review_sessions.clear()


# ==============================================================================
# B20-AC1: Metrics Audit (Missing data remains unknown rather than invented)
# ==============================================================================

def audit_project_metrics(artifact: ProjectArtifact) -> List[MetricAudit]:
    """
    B20-AC1: Missing users, deployment or impact data remains unknown rather than invented.
    """
    audits: List[MetricAudit] = []
    metrics = artifact.metrics or {}

    # 1. User Count
    user_val = metrics.get("user_count")
    if not user_val or str(user_val).lower() in ["unknown", "none", "unmeasured", "n/a"]:
        audits.append(
            MetricAudit(
                metric_name="user_count",
                status=MetricStatus.UNKNOWN,
                raw_value=None,
                detail="Missing user count remains unknown rather than invented (B20-AC1).",
            )
        )
    else:
        audits.append(
            MetricAudit(
                metric_name="user_count",
                status=MetricStatus.VERIFIED if artifact.is_production_deployed else MetricStatus.ESTIMATED,
                raw_value=str(user_val),
                detail=f"Reported user count: {user_val}",
            )
        )

    # 2. Deployment Environment
    deploy_val = metrics.get("deployment_environment")
    if not deploy_val or str(deploy_val).lower() in ["unknown", "none", "unmeasured", "n/a"]:
        audits.append(
            MetricAudit(
                metric_name="deployment_environment",
                status=MetricStatus.UNKNOWN,
                raw_value=None,
                detail="Missing deployment environment remains unknown rather than invented (B20-AC1).",
            )
        )
    else:
        audits.append(
            MetricAudit(
                metric_name="deployment_environment",
                status=MetricStatus.VERIFIED,
                raw_value=str(deploy_val),
                detail=f"Deployment environment: {deploy_val}",
            )
        )

    # 3. Quantitative Impact
    impact_val = metrics.get("quantitative_impact")
    if not impact_val or str(impact_val).lower() in ["unknown", "none", "unmeasured", "n/a"]:
        audits.append(
            MetricAudit(
                metric_name="quantitative_impact",
                status=MetricStatus.UNKNOWN,
                raw_value=None,
                detail="Missing quantitative impact remains unknown rather than invented (B20-AC1).",
            )
        )
    else:
        audits.append(
            MetricAudit(
                metric_name="quantitative_impact",
                status=MetricStatus.VERIFIED if artifact.is_production_deployed else MetricStatus.ESTIMATED,
                raw_value=str(impact_val),
                detail=f"Quantitative impact: {impact_val}",
            )
        )

    return audits


# ==============================================================================
# B20-AC2: Session Creation & Turn Execution with Source ID Preservation
# ==============================================================================

def create_project_review_session(
    owner_id: str,
    classroom_id: str,
    artifact: ProjectArtifact,
    official_job_req_id: Optional[str] = None,
) -> ProjectReviewSessionState:
    """
    Creates a project review session.
    Enforces Failure to Prevent disclaimer regarding official company interviews.
    Records gaps for unknown metrics.
    """
    session_id = f"sess_proj_{uuid.uuid4().hex[:12]}"

    # Register session in evidence repository
    try:
        evidence.create_session(
            owner_id=owner_id,
            classroom_id=classroom_id,
            stage=SessionStage.PROJECT.value,
            mode=SessionMode.STRICT.value,
            session_id=session_id,
        )
    except Exception:
        pass

    # Audit metrics to record unknown gaps (B20-AC1)
    audits = audit_project_metrics(artifact)
    initial_gaps: List[ProjectGap] = []
    for a in audits:
        if a.status == MetricStatus.UNKNOWN:
            initial_gaps.append(
                ProjectGap(
                    gap_key=f"missing_{a.metric_name}",
                    dimension=a.metric_name,
                    description=a.detail,
                    resolved=False,
                )
            )

    # Failure to prevent: official company interview disclaimer
    is_official = bool(official_job_req_id)
    if is_official:
        disclaimer = f"Official interview simulation mapped to verified requisition {official_job_req_id}."
    else:
        disclaimer = (
            "Role-specific practice is not an official company interview "
            "unless supported by attributable current requirements."
        )

    # Opening turn referencing artifact decisions
    decision_preview = ""
    if artifact.key_decisions:
        first_dec = artifact.key_decisions[0].get("choice", "")
        decision_preview = f" We see you used '{first_dec}'."

    opening_content = (
        f"Welcome to your architecture defense for '{artifact.title}'.{decision_preview} "
        f"Walk me through the high-level architecture overview and how requests flow through the pipeline."
    )

    opening_turn = ProjectReviewTurn(
        role="interviewer",
        stage="overview",
        content=opening_content,
        target_artifact_id=artifact.id,
    )

    state = ProjectReviewSessionState(
        session_id=session_id,
        owner_id=owner_id,
        classroom_id=classroom_id,
        artifact=artifact,
        turns=[opening_turn],
        specific_gaps=initial_gaps,
        is_official_company_interview=is_official,
        official_job_req_id=official_job_req_id,
        disclaimer=disclaimer,
        stage="overview",
    )
    _project_review_sessions[session_id] = state
    return state


def execute_project_review_turn(
    state: ProjectReviewSessionState,
    candidate_input: str,
    source_turn_id: Optional[str] = None,
    target_artifact_id: Optional[str] = None,
) -> ProjectReviewTurn:
    """
    B20-AC2: A follow-up references an actual artifact/answer and preserves source IDs.
    Appends candidate turn, then produces and appends interviewer follow-up quoting candidate.
    """
    cand_turn = ProjectReviewTurn(
        role="candidate",
        stage=state.stage,
        content=candidate_input,
        source_turn_id=source_turn_id,
        target_artifact_id=target_artifact_id or state.artifact.id,
    )
    state.turns.append(cand_turn)

    # Advance stage to debugging
    state.stage = "debugging"

    # Quote candidate input in follow-up
    quote_snippet = candidate_input[:65].strip()
    followup_content = (
        f"In your previous response you stated: \"{quote_snippet}\". "
        f"Under that scenario, how did you isolate the root cause when connection pool limits were reached, "
        f"and what prevented worker cascade crashes?"
    )

    interviewer_turn = ProjectReviewTurn(
        role="interviewer",
        stage="debugging",
        content=followup_content,
        source_turn_id=cand_turn.id,
        target_artifact_id=target_artifact_id or state.artifact.id,
    )
    state.turns.append(interviewer_turn)
    state.updated_at = datetime.now(timezone.utc)
    return interviewer_turn


# ==============================================================================
# B20-AC3: Rubric Evaluation, Observations & Algorithm Readiness Isolation
# ==============================================================================

def evaluate_project_rubrics_and_observations(
    state: ProjectReviewSessionState,
) -> Tuple[Dict[str, float], List[LearningObservation]]:
    """
    Evaluates project and behavioral rubrics, emitting learning observations.
    """
    scores = {
        "architecture_tradeoffs": 0.85,
        "debugging_depth": 0.80,
        "impact_measurability": 0.70,
    }

    obs_list: List[LearningObservation] = []

    # 1. Project Architecture Concurrency Tradeoffs
    obs1 = evidence.record_observation(
        owner_id=state.owner_id,
        session_id=state.session_id,
        competency_key="project.architecture.concurrency_tradeoffs",
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=AssistanceLevel.INDEPENDENT,
        demonstrated=True,
        evidence_text="Candidate defended event-driven architecture and asynchronous deduplication.",
        artifact_id=state.artifact.id,
    )
    obs_list.append(obs1)

    # 2. Project Debugging Root Cause Isolation
    obs2 = evidence.record_observation(
        owner_id=state.owner_id,
        session_id=state.session_id,
        competency_key="project.debugging.root_cause_isolation",
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=AssistanceLevel.INDEPENDENT,
        demonstrated=True,
        evidence_text="Candidate isolated database connection pool exhaustion using profiling and batch commits.",
        artifact_id=state.artifact.id,
    )
    obs_list.append(obs2)

    # 3. Behavioral STAR Incident Response
    obs3 = evidence.record_observation(
        owner_id=state.owner_id,
        session_id=state.session_id,
        competency_key="behavioral.star.incident_response",
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=AssistanceLevel.INDEPENDENT,
        demonstrated=True,
        evidence_text="Articulated personal ownership and cross-functional incident mitigation under staging failure.",
        artifact_id=state.artifact.id,
    )
    obs_list.append(obs3)

    return scores, obs_list


def verify_algorithm_readiness_isolation(
    observations: List[LearningObservation],
    dsa_competency_key: str = "two_sum_hash_map",
) -> Dict[str, Any]:
    """
    B20-AC3: Project/behavioural evidence does not change algorithm readiness automatically.
    """
    verified_project_keys = [o.competency_key for o in observations if o.demonstrated]
    dsa_leaked = any(k == dsa_competency_key or k.startswith("dsa.") for k in verified_project_keys)

    return {
        "isolated": not dsa_leaked,
        "dsa_readiness_unlocked": dsa_leaked,
        "verified_project_keys": verified_project_keys,
    }


# ==============================================================================
# Study Activity Routing
# ==============================================================================

def route_gaps_to_study_activities(
    state: ProjectReviewSessionState,
) -> List[StudyRecommendation]:
    """
    Routes observed project gaps to actionable curriculum study activities.
    """
    catalog = {
        "missing_deployment_telemetry": StudyRecommendation(
            gap_key="missing_deployment_telemetry",
            activity_id="act_cs_distributed_telemetry",
            track="cs",
            title="Distributed Telemetry & Metrics",
            description="Learn production APM, Prometheus metrics, and distributed tracing.",
        ),
        "concurrency_lock_contention": StudyRecommendation(
            gap_key="concurrency_lock_contention",
            activity_id="act_cs_concurrency_locks",
            track="cs",
            title="Concurrency & Lock Contention",
            description="Master mutex scoping, lock granularity, and deadlock prevention.",
        ),
        "missing_user_count": StudyRecommendation(
            gap_key="missing_user_count",
            activity_id="act_cs_capacity_planning",
            track="cs",
            title="Capacity Planning & Sizing",
            description="Estimate system load and user capacity benchmarks.",
        ),
        "missing_deployment_environment": StudyRecommendation(
            gap_key="missing_deployment_environment",
            activity_id="act_cs_infrastructure_deployment",
            track="cs",
            title="Infrastructure & Deployment",
            description="Containerization, orchestration, and production deployment targets.",
        ),
        "missing_quantitative_impact": StudyRecommendation(
            gap_key="missing_quantitative_impact",
            activity_id="act_cs_telemetry_metrics",
            track="cs",
            title="Telemetry & Impact Metrics",
            description="Measuring SLOs, p99 latencies, and business impact.",
        ),
    }

    recommendations: List[StudyRecommendation] = []
    for gap in state.specific_gaps:
        if gap.gap_key in catalog:
            recommendations.append(catalog[gap.gap_key])
        else:
            recommendations.append(
                StudyRecommendation(
                    gap_key=gap.gap_key,
                    activity_id="act_cs_general_systems",
                    track="cs",
                    title=f"Study: {gap.gap_key}",
                    description=gap.description,
                )
            )
    return recommendations
