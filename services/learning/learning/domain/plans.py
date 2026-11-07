"""
Sprint B13: Capacity-Aware Planning Domain Contracts.
Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md

Defines typed Pydantic models for:
- Capacity tiers & declared availability
- Planned tasks with pedagogical priority and gap provenance
- Versioned plan revisions with optimistic concurrency control
- Plan preview, commit, and today view wire models
"""

import math
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class CapacityTier(str, Enum):
    REST = "rest"          # 0 min
    MINIMUM = "minimum"    # 15 min (floor(0.8*15) = 12 min)
    RAMP = "ramp"          # 45 min (floor(0.8*45) = 36 min)
    NORMAL = "normal"      # 90 min (floor(0.8*90) = 72 min)
    BONUS = "bonus"        # 120 min (floor(0.8*120) = 96 min)


class TaskKind(str, Enum):
    DSA_PRACTICE = "dsa_practice"
    CONCEPT_PROBE = "concept_probe"
    DIAGNOSTIC_REPAIR = "diagnostic_repair"
    RETRIEVAL_REVIEW = "retrieval_review"


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class PlannedTask(BaseModel):
    id: str
    competency_key: str
    title: str
    duration_minutes: int = Field(ge=1)
    kind: TaskKind
    activity_id: Optional[str] = None
    session_id: Optional[str] = None
    status: TaskStatus = TaskStatus.PENDING
    priority_score: float = 0.0
    priority_reason: str = ""
    source_gap: Optional[str] = None
    is_carryover: bool = False
    completed_at: Optional[str] = None


class DeclaredCapacity(BaseModel):
    date: str  # ISO date YYYY-MM-DD
    declared_minutes: int = Field(ge=0)
    tier: CapacityTier = CapacityTier.NORMAL
    is_rest_day: bool = False

    @property
    def effective_budget_minutes(self) -> int:
        """Enforces §11.2 Rule 1: floor(0.8 * declaredAvailableMinutes)."""
        if self.is_rest_day or self.declared_minutes <= 0:
            return 0
        return math.floor(0.8 * self.declared_minutes)


class PlanRevisionRecord(BaseModel):
    id: str
    owner_id: str
    date: str  # ISO date YYYY-MM-DD
    revision: int = Field(ge=1)
    declared_capacity_minutes: int
    effective_budget_minutes: int
    tasks: List[PlannedTask] = Field(default_factory=list)
    explanation: str = ""
    is_committed: bool = False
    is_skipped_day: bool = False
    created_at: str
    updated_at: str


class PlanPreviewRequest(BaseModel):
    date: str  # ISO date YYYY-MM-DD
    declared_minutes: Optional[int] = None
    tier: Optional[CapacityTier] = None
    force_replan: bool = False


class PlanPreviewResponse(BaseModel):
    plan_id: str
    base_revision: int
    date: str
    declared_capacity_minutes: int
    effective_budget_minutes: int
    allocated_tasks: List[PlannedTask]
    deferred_tasks: List[PlannedTask]
    bounded_explanation: str
    total_allocated_minutes: int


class PlanCommitRequest(BaseModel):
    plan_id: str
    expected_revision: int = Field(ge=1)
    date: str
    task_ids: List[str]
    declared_minutes: int = Field(ge=0)


class TodayPlanResponse(BaseModel):
    plan_id: str
    date: str
    revision: int
    declared_capacity_minutes: int
    effective_budget_minutes: int
    is_rest_day: bool
    is_skipped_day: bool
    tasks: List[PlannedTask]
    explanation: str
    total_allocated_minutes: int
    completed_minutes: int
    is_recovered_day: bool = False
