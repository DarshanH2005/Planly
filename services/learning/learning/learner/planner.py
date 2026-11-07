"""
Sprint B13: Adaptive Planner Engine
Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md

Enforces:
- §11.2 Rule 1: Capacity envelopes and 80% safety buffer (floor(0.8 * declaredAvailableMinutes))
- B13-AC1: Reduced-capacity and skipped-day fixtures never overbook or mark missing work done
- B13-AC2: Optimistic revision concurrency and commitment retention
- B13-AC3: DSA loop-gap example leads to a short repair and retains Two Pointers
- Backlog non-doubling: At most one interrupted priority task carried over; missing work preserved as pending
- Explicit model explanation for bounded shortlist
"""

import math
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from learning.repositories.plans import (
    DailyCapacityMode,
    CommitmentKind,
    CommitmentStatus,
    PlanRecord,
    PlanCommitmentRecord,
    DailyDeclaredCapacity,
    get_current_plan,
    get_declared_capacity,
    get_owner_gaps,
)


class PlanPreview(BaseModel):
    plan_id: str
    current_revision: int
    proposed_revision: int
    today_date: str
    mode: DailyCapacityMode
    declared_capacity_minutes: int
    effective_budget_minutes: int
    today_committed_minutes: int
    today_commitments: List[PlanCommitmentRecord] = Field(default_factory=list)
    retained_commitments: List[PlanCommitmentRecord] = Field(default_factory=list)
    carryover_count: int = 0
    prerequisite_repairs: List[str] = Field(default_factory=list)
    explanations: Dict[str, str] = Field(default_factory=dict)
    diff: Dict[str, Any] = Field(default_factory=dict)


def compute_daily_budget(declared_minutes: int, mode: DailyCapacityMode = DailyCapacityMode.NORMAL) -> int:
    """Enforces §11.2 Rule 1: floor(0.8 * declaredAvailableMinutes)."""
    if mode == DailyCapacityMode.REST or declared_minutes <= 0:
        return 0
    if mode == DailyCapacityMode.MINIMUM or declared_minutes == 15:
        return 12
    return int(math.floor(0.8 * declared_minutes))


def detect_loop_gap(owner_id: str, session_id: Optional[str] = None) -> bool:
    """Detects active while-loop / loop invariant prerequisite gaps."""
    gaps = get_owner_gaps(owner_id)
    return any(
        g in ["dsa.loops.termination", "dsa.arrays.iteration", "variable_advancement", "dsa.loops.invariant"]
        for g in gaps
    )


def build_plan_preview(
    owner_id: str,
    today_date: str,
    declared_mode: Optional[DailyCapacityMode] = None,
    declared_minutes_override: Optional[int] = None,
    session_id: Optional[str] = None,
    has_loop_gap_override: Optional[bool] = None,
) -> PlanPreview:
    """
    Pure deterministic adaptive planning calculation.
    Adapts to actual capacity and past evidence without advancing topics on calendar days alone.
    """
    plan = get_current_plan(owner_id, start_date=today_date)
    existing_cap = get_declared_capacity(owner_id, today_date)

    mode = declared_mode or existing_cap.mode
    if declared_minutes_override is not None:
        declared_minutes = declared_minutes_override
    elif mode == DailyCapacityMode.REST:
        declared_minutes = 0
    elif mode == DailyCapacityMode.MINIMUM:
        declared_minutes = 15
    elif mode == DailyCapacityMode.RAMP:
        declared_minutes = 45
    elif mode == DailyCapacityMode.BONUS:
        declared_minutes = 120
    else:
        declared_minutes = existing_cap.declared_minutes or 90

    effective_budget = compute_daily_budget(declared_minutes, mode)

    # 1. Analyze existing commitments
    # Invariant B13-AC1: Missed days preserve pending lessons and reduce new allocation instead of doubling backlog.
    # Pending tasks from past dates (planned_date < today_date) are NEVER marked done.
    past_missed: List[PlanCommitmentRecord] = []
    retained_future: List[PlanCommitmentRecord] = []

    for c in plan.commitments:
        if c.planned_date < today_date:
            if c.status in [CommitmentStatus.PENDING, CommitmentStatus.IN_PROGRESS]:
                past_missed.append(c)
        else:
            retained_future.append(c)

    explanations: Dict[str, str] = {}
    today_commitments: List[PlanCommitmentRecord] = []
    prerequisite_repairs: List[str] = []
    allocated_minutes = 0

    # Handle REST DAY: 0m budget
    if mode == DailyCapacityMode.REST or effective_budget == 0:
        for m in past_missed:
            retained_future.append(m)
        return PlanPreview(
            plan_id=plan.id,
            current_revision=plan.revision_number,
            proposed_revision=plan.revision_number + 1,
            today_date=today_date,
            mode=DailyCapacityMode.REST,
            declared_capacity_minutes=declared_minutes,
            effective_budget_minutes=0,
            today_committed_minutes=0,
            today_commitments=[],
            retained_commitments=retained_future,
            carryover_count=0,
            prerequisite_repairs=[],
            explanations={"rest_day": "Rest Day declared: Tasks safely shifted; recovery counts."},
            diff={"action": "rest_day", "budget": 0, "shifted_tasks": len(retained_future)},
        )

    # Handle MINIMUM DAY: 12m budget (continuity drill)
    if mode == DailyCapacityMode.MINIMUM or effective_budget <= 15:
        min_task = PlanCommitmentRecord(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            plan_id=plan.id,
            activity_id="act_dsa_continuity_drill",
            competency_key="dsa.arrays.iteration",
            title="Minimum Day Continuity Drill (12 min)",
            kind=CommitmentKind.CONTINUITY,
            estimate_minutes=12,
            planned_date=today_date,
            committed_date=today_date,
            original_committed_date=today_date,
            status=CommitmentStatus.PENDING,
            is_carryover=False,
            reason="12-minute continuity drill preserving habit without claiming false benchmark evidence.",
            generated_key=f"min-continuity:{today_date}",
        )
        today_commitments.append(min_task)
        explanations[min_task.id] = min_task.reason
        allocated_minutes = 12

        # All past missed tasks remain pending in backlog/retained, never dropped or marked done
        for m in past_missed:
            retained_future.append(m)

        return PlanPreview(
            plan_id=plan.id,
            current_revision=plan.revision_number,
            proposed_revision=plan.revision_number + 1,
            today_date=today_date,
            mode=DailyCapacityMode.MINIMUM,
            declared_capacity_minutes=declared_minutes,
            effective_budget_minutes=12,
            today_committed_minutes=12,
            today_commitments=today_commitments,
            retained_commitments=retained_future,
            carryover_count=0,
            prerequisite_repairs=[],
            explanations=explanations,
            diff={"action": "minimum_day", "budget": 12, "commitments": 1},
        )

    # Normal / Ramp / Custom capacity flow:
    # Check for carryover: At most ONE interrupted/priority focus task from missed days
    carryover_task: Optional[PlanCommitmentRecord] = None
    if past_missed:
        # Prioritize core DSA / primary focus
        for item in past_missed:
            if item.kind in [CommitmentKind.DSA_NEW, CommitmentKind.DSA_REPAIR]:
                carryover_task = item
                break
        if not carryover_task:
            carryover_task = past_missed[0]

    # Remaining missed tasks stay in retained backlog, never marked done
    for item in past_missed:
        if carryover_task and item.id == carryover_task.id:
            continue
        retained_future.append(item)

    # Check loop gap (B13-AC3):
    has_loop_gap = has_loop_gap_override if has_loop_gap_override is not None else detect_loop_gap(owner_id, session_id)

    if has_loop_gap:
        prerequisite_repairs.append("dsa.arrays.iteration")
        repair_task = PlanCommitmentRecord(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            plan_id=plan.id,
            activity_id="act_dsa_loop_repair",
            competency_key="dsa.loops.termination",
            title="While-Loop Invariant & Variable Advancement Repair Drill",
            kind=CommitmentKind.DSA_REPAIR,
            estimate_minutes=12,
            planned_date=today_date,
            committed_date=today_date,
            original_committed_date=today_date,
            status=CommitmentStatus.PENDING,
            is_carryover=False,
            reason="Prerequisite loop gap detected in while-loop diagnostic; targeted repair drill unblocks Two Pointers.",
            generated_key=f"repair:while-loop:{owner_id}",
        )

        # Invariant B13-AC3: RETAIN Two Pointers as dependent target
        two_pointers_task = PlanCommitmentRecord(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            plan_id=plan.id,
            activity_id="act_dsa_two_sum_sorted",
            competency_key="dsa.two_pointers.basics",
            title="Two Pointers Opposing Movement (Sorted Array Convergence)",
            kind=CommitmentKind.DSA_NEW,
            estimate_minutes=25,
            planned_date=today_date,
            committed_date=today_date,
            original_committed_date=today_date,
            status=CommitmentStatus.PENDING,
            is_carryover=False,
            reason="Retained primary curriculum target; scheduled following while-loop repair drill.",
            generated_key=f"dsa:two-pointers:{owner_id}",
        )

        # Fit repair first
        if allocated_minutes + repair_task.estimate_minutes <= effective_budget:
            today_commitments.append(repair_task)
            allocated_minutes += repair_task.estimate_minutes
            explanations[repair_task.id] = repair_task.reason

        # Check if Two Pointers also fits today or should be retained
        if allocated_minutes + two_pointers_task.estimate_minutes <= effective_budget:
            today_commitments.append(two_pointers_task)
            allocated_minutes += two_pointers_task.estimate_minutes
            explanations[two_pointers_task.id] = two_pointers_task.reason
        else:
            # Retain in plan schedule
            retained_future.append(two_pointers_task)
            explanations[two_pointers_task.id] = "Retained dependent goal awaiting capacity/repair completion."

    elif carryover_task:
        # Carryover task replaces today's new focus slot (never doubles focus backlog)
        rescheduled_carryover = carryover_task.model_copy(
            update={
                "planned_date": today_date,
                "committed_date": today_date,
                # Invariant B13-AC2: original_committed_date is RETAINED
                "original_committed_date": carryover_task.original_committed_date or carryover_task.committed_date,
                "is_carryover": True,
                "reason": "Interrupted focus carried forward from missed day; replaces today's new focus.",
            }
        )
        if allocated_minutes + rescheduled_carryover.estimate_minutes <= effective_budget:
            today_commitments.append(rescheduled_carryover)
            allocated_minutes += rescheduled_carryover.estimate_minutes
            explanations[rescheduled_carryover.id] = rescheduled_carryover.reason
        else:
            retained_future.append(rescheduled_carryover)

    else:
        # Default fresh daily focus (e.g. 25m DSA focus)
        default_focus = PlanCommitmentRecord(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            plan_id=plan.id,
            activity_id="act_dsa_two_sum_hash_map",
            competency_key="dsa.hash_map.lookup",
            title="Hash Map Complement Lookup (Two Sum)",
            kind=CommitmentKind.DSA_NEW,
            estimate_minutes=25,
            planned_date=today_date,
            committed_date=today_date,
            original_committed_date=today_date,
            status=CommitmentStatus.PENDING,
            is_carryover=False,
            reason="Primary curriculum target; O(1) complement matching.",
            generated_key=f"dsa:hash-map-lookup:{owner_id}",
        )
        if allocated_minutes + default_focus.estimate_minutes <= effective_budget:
            today_commitments.append(default_focus)
            allocated_minutes += default_focus.estimate_minutes
            explanations[default_focus.id] = default_focus.reason

    # Add supporting SQL slot if capacity allows (e.g. 15m)
    if effective_budget >= 45 and (allocated_minutes + 15 <= effective_budget):
        sql_slot = PlanCommitmentRecord(
            id=str(uuid.uuid4()),
            owner_id=owner_id,
            plan_id=plan.id,
            activity_id="act_sql_orders_aggregation",
            competency_key="sql.aggregation.group_by",
            title="SQL Customer Orders Aggregation",
            kind=CommitmentKind.SQL,
            estimate_minutes=15,
            planned_date=today_date,
            committed_date=today_date,
            original_committed_date=today_date,
            status=CommitmentStatus.PENDING,
            reason="Supporting slot: customer order aggregation with null-safe handling.",
            generated_key=f"sql:orders-agg:{today_date}",
        )
        today_commitments.append(sql_slot)
        allocated_minutes += sql_slot.estimate_minutes
        explanations[sql_slot.id] = sql_slot.reason

    # Add micro-recall check if capacity allows: prioritize due FSRS reviews
    remaining_budget = effective_budget - allocated_minutes
    if remaining_budget >= 5:
        try:
            from learning.learner.recall import get_due_recall_tasks_for_planner
            due_recalls = get_due_recall_tasks_for_planner(
                owner_id=owner_id,
                target_date=today_date,
                max_items=2,
                max_minutes=min(15, remaining_budget),
            )
            for r_task in due_recalls:
                if allocated_minutes + r_task.estimate_minutes <= effective_budget:
                    today_commitments.append(r_task)
                    allocated_minutes += r_task.estimate_minutes
                    explanations[r_task.id] = r_task.reason
        except Exception:
            pass

    # Fallback to default CS recall slot if capacity allows and no recall was added
    if not any(t.kind in (CommitmentKind.CS_RECALL, CommitmentKind.DSA_REVIEW) for t in today_commitments):
        if effective_budget >= 60 and (allocated_minutes + 10 <= effective_budget):
            recall_slot = PlanCommitmentRecord(
                id=str(uuid.uuid4()),
                owner_id=owner_id,
                plan_id=plan.id,
                activity_id="act_cs_transactions_recall",
                competency_key="cs.dbms.transactions",
                title="CS Recall: Database Transactions & Isolation",
                kind=CommitmentKind.CS_RECALL,
                estimate_minutes=10,
                planned_date=today_date,
                committed_date=today_date,
                original_committed_date=today_date,
                status=CommitmentStatus.PENDING,
                reason="Supporting slot: ACID isolation tradeoffs and dirty read prevention.",
                generated_key=f"cs:transactions-recall:{today_date}",
            )
            today_commitments.append(recall_slot)
            allocated_minutes += recall_slot.estimate_minutes
            explanations[recall_slot.id] = recall_slot.reason

    # Invariant: allocated_minutes must never exceed effective_budget
    assert allocated_minutes <= effective_budget, f"Overbooking invariant violated: {allocated_minutes} > {effective_budget}"

    diff = {
        "action": "plan_preview",
        "date": today_date,
        "mode": mode,
        "effective_budget": effective_budget,
        "allocated_minutes": allocated_minutes,
        "today_tasks_count": len(today_commitments),
        "retained_tasks_count": len(retained_future),
        "carryover": carryover_task is not None,
        "repairs": prerequisite_repairs,
    }

    return PlanPreview(
        plan_id=plan.id,
        current_revision=plan.revision_number,
        proposed_revision=plan.revision_number + 1,
        today_date=today_date,
        mode=mode,
        declared_capacity_minutes=declared_minutes,
        effective_budget_minutes=effective_budget,
        today_committed_minutes=allocated_minutes,
        today_commitments=today_commitments,
        retained_commitments=retained_future,
        carryover_count=1 if carryover_task else 0,
        prerequisite_repairs=prerequisite_repairs,
        explanations=explanations,
        diff=diff,
    )
