"""
Sprint B14: Versioned FSRS Recall Scheduler Adapter & Pedagogical Boundary.
Authority: planly_architecture.md sections 7, 12; B14_recall_scheduler.md

Enforces:
- py-fsrs scheduler integration behind a versioned adapter with personalized fitting disabled.
- B14-AC1: Idempotency preventing duplicate reviews from advancing schedule twice.
- B14-AC2: Timezone boundary conversion using stored UTC instants and configured timezone (Asia/Kolkata).
- B14-AC3: High recall estimate does not unlock unfamiliar DSA readiness claims.
- Failure to prevent: FSRS measures declarative item recall; it does NOT estimate interview pass probability.
"""

from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math

from fsrs import Scheduler, Card, Rating, State

from learning.repositories.recall import (
    RecallRating,
    RecallItemKind,
    RecallCardState,
    RecallItemRecord,
    ReviewLogRecord,
    create_or_get_recall_item,
    get_recall_item,
    list_owner_recall_items,
    record_review_result,
)
from learning.repositories.plans import (
    PlanCommitmentRecord,
    CommitmentKind,
    CommitmentStatus,
)

FSRS_RATING_MAP = {
    RecallRating.AGAIN: Rating.Again,
    RecallRating.HARD: Rating.Hard,
    RecallRating.GOOD: Rating.Good,
    RecallRating.EASY: Rating.Easy,
}

FSRS_STATE_MAP = {
    RecallCardState.NEW: State.Learning,
    RecallCardState.LEARNING: State.Learning,
    RecallCardState.REVIEW: State.Review,
    RecallCardState.RELEARNING: State.Relearning,
}

REVERSE_STATE_MAP = {
    State.Learning: RecallCardState.LEARNING,
    State.Review: RecallCardState.REVIEW,
    State.Relearning: RecallCardState.RELEARNING,
}


class FSRSSchedulerAdapter:
    """
    Versioned adapter around py-fsrs.
    Personalized parameter fitting is intentionally disabled until large review volume
    supports valid comparison (B14 specification requirement 4).
    """

    def __init__(self, desired_retention: float = 0.9):
        self.desired_retention = desired_retention
        # Standard FSRS default parameters; personalized fitting is disabled
        self.scheduler = Scheduler(desired_retention=desired_retention)
        self.personalized_fitting_enabled = False

    def schedule_review(
        self,
        item: RecallItemRecord,
        rating: RecallRating,
        reviewed_at_utc: Optional[datetime] = None,
    ) -> Tuple[RecallItemRecord, int, int, int]:
        """
        Calculates new FSRS state, stability, difficulty, and due instant.
        Returns (updated_item, scheduled_days, elapsed_days, last_elapsed_days).
        """
        review_dt = reviewed_at_utc or datetime.now(timezone.utc)
        if review_dt.tzinfo is None:
            review_dt = review_dt.replace(tzinfo=timezone.utc)

        # Reconstruct fsrs.Card from persistent state
        card = Card()
        try:
            card.due = datetime.fromisoformat(item.due_at_utc)
            if card.due.tzinfo is None:
                card.due = card.due.replace(tzinfo=timezone.utc)
        except Exception:
            card.due = review_dt

        card.stability = item.stability if item.stability > 0 else None
        card.difficulty = item.difficulty if item.difficulty > 0 else None
        card.step = item.step
        card.state = FSRS_STATE_MAP.get(item.state, State.Learning)
        if item.last_reviewed_at_utc:
            try:
                card.last_review = datetime.fromisoformat(item.last_reviewed_at_utc)
                if card.last_review.tzinfo is None:
                    card.last_review = card.last_review.replace(tzinfo=timezone.utc)
            except Exception:
                card.last_review = None

        fsrs_rating = FSRS_RATING_MAP.get(rating, Rating.Good)
        updated_card, fsrs_log = self.scheduler.review_card(card, fsrs_rating, review_datetime=review_dt)

        scheduled_days = max(1, (updated_card.due - review_dt).days) if updated_card.due else 1
        elapsed_days = (review_dt - card.last_review).days if card.last_review else 0
        last_elapsed_days = 0

        # Compute retrievability at next due instant
        retrievability = 1.0
        if updated_card.stability and updated_card.stability > 0:
            retrievability = self.calculate_retrievability(updated_card.stability, elapsed_days=0)

        new_due_utc = updated_card.due.astimezone(timezone.utc).isoformat()
        now_iso = review_dt.astimezone(timezone.utc).isoformat()

        updated_item = item.model_copy(
            update={
                "due_at_utc": new_due_utc,
                "stability": updated_card.stability or 0.0,
                "difficulty": updated_card.difficulty or 0.0,
                "step": updated_card.step,
                "state": REVERSE_STATE_MAP.get(updated_card.state, RecallCardState.REVIEW),
                "last_reviewed_at_utc": now_iso,
                "review_count": item.review_count + 1,
                "last_rating": rating,
                "retrievability": retrievability,
                "updated_at_utc": now_iso,
            }
        )

        return updated_item, scheduled_days, elapsed_days, last_elapsed_days

    def calculate_retrievability(self, stability: float, elapsed_days: float) -> float:
        """
        FSRS retrievability decay formula:
        R(t) = (1 + factor * t / S)^decay
        With standard FSRS parameters: factor = 19/81, decay = -0.5
        """
        if stability <= 0:
            return 0.0
        factor = 19.0 / 81.0
        decay = -0.5
        return math.pow(1.0 + factor * (elapsed_days / stability), decay)


# Global scheduler adapter instance
recall_scheduler = FSRSSchedulerAdapter()


# -----------------------------------------------------------------------------
# Timezone Boundary Calculations (B14-AC2)
# -----------------------------------------------------------------------------

def to_local_study_date(utc_instant_str: str, timezone_name: str = "Asia/Kolkata") -> str:
    """
    Converts a stored UTC instant to the local calendar study date (YYYY-MM-DD)
    using the user's configured timezone.
    """
    dt = datetime.fromisoformat(utc_instant_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local_dt = dt.astimezone(ZoneInfo(timezone_name))
    return local_dt.strftime("%Y-%m-%d")


def is_item_due(
    due_at_utc_str: str,
    as_of_utc: datetime,
    timezone_name: str = "Asia/Kolkata",
) -> bool:
    """
    Determines if a recall item is due as of a reference time.
    Grounds in both UTC instant comparison and local calendar day boundaries.
    """
    due_dt = datetime.fromisoformat(due_at_utc_str)
    if due_dt.tzinfo is None:
        due_dt = due_dt.replace(tzinfo=timezone.utc)

    if as_of_utc.tzinfo is None:
        as_of_utc = as_of_utc.replace(tzinfo=timezone.utc)

    # If UTC instant has passed, it is strictly due
    if due_dt <= as_of_utc:
        return True

    # Check local study calendar date: if due date matches or precedes local study date
    local_due_date = due_dt.astimezone(ZoneInfo(timezone_name)).date()
    local_as_of_date = as_of_utc.astimezone(ZoneInfo(timezone_name)).date()
    return local_due_date <= local_as_of_date


# -----------------------------------------------------------------------------
# Item Generation from Evidence & Mistakes (Specification requirement 2)
# -----------------------------------------------------------------------------

def generate_recall_from_mistake(
    owner_id: str,
    mistake_key: str,
    observation_text: str,
    corrected_rule: str,
    competency_key: str,
    counterexample: Optional[str] = None,
    session_id: Optional[str] = None,
) -> RecallItemRecord:
    """Generates a micro-recall item from an identified mistake and corrected rule."""
    item_key = f"mistake:{competency_key}:{mistake_key}"
    title = f"Mistake Recall: {corrected_rule[:60]}"
    prompt = f"When handling {competency_key}: What mistake was made and what is the corrected invariant?"
    answer = f"Observation: {observation_text}\nCorrected Rule: {corrected_rule}"
    if counterexample:
        answer += f"\nCounterexample: {counterexample}"

    item, _ = create_or_get_recall_item(
        owner_id=owner_id,
        item_key=item_key,
        title=title,
        prompt=prompt,
        answer=answer,
        kind=RecallItemKind.MISTAKE,
        source_kind="mistake",
        source_id=session_id,
        competency_key=competency_key,
        expected_minutes=5,
    )
    return item


def generate_recall_from_concept(
    owner_id: str,
    concept_key: str,
    title: str,
    prompt: str,
    answer: str,
    competency_key: str,
) -> RecallItemRecord:
    """Generates a micro-recall item from a core concept or invariant."""
    item_key = f"concept:{competency_key}:{concept_key}"
    item, _ = create_or_get_recall_item(
        owner_id=owner_id,
        item_key=item_key,
        title=title,
        prompt=prompt,
        answer=answer,
        kind=RecallItemKind.CONCEPT,
        source_kind="concept",
        competency_key=competency_key,
        expected_minutes=5,
    )
    return item


# -----------------------------------------------------------------------------
# Review Execution with Idempotency Guard (B14-AC1)
# -----------------------------------------------------------------------------

def process_review_submission(
    owner_id: str,
    item_id: str,
    review_request_id: str,
    rating: RecallRating,
    reviewed_at_utc: Optional[datetime] = None,
) -> Tuple[RecallItemRecord, ReviewLogRecord, bool]:
    """
    Executes review and persists result.
    B14-AC1: If review_request_id was already processed, returns existing state
             without advancing the FSRS card or schedule twice!
    """
    item = get_recall_item(owner_id, item_id)
    if not item:
        raise ValueError(f"Recall item '{item_id}' not found for owner '{owner_id}'")

    review_dt = reviewed_at_utc or datetime.now(timezone.utc)
    if review_dt.tzinfo is None:
        review_dt = review_dt.replace(tzinfo=timezone.utc)

    # Compute FSRS update
    updated_item, sched_days, elap_days, last_elap_days = recall_scheduler.schedule_review(
        item=item,
        rating=rating,
        reviewed_at_utc=review_dt,
    )

    # Atomically commit or return idempotent result
    return record_review_result(
        owner_id=owner_id,
        item_id=item_id,
        review_request_id=review_request_id,
        rating=rating,
        updated_item=updated_item,
        scheduled_days=sched_days,
        elapsed_days=elap_days,
        last_elapsed_days=last_elap_days,
        reviewed_at_utc=review_dt.isoformat(),
    )


# -----------------------------------------------------------------------------
# Non-Conflation / Readiness Separation Guardrail (B14-AC3)
# -----------------------------------------------------------------------------

def evaluate_dsa_readiness(
    competency_key: str,
    recall_item: Optional[RecallItemRecord],
    verified_problem_solving_success: bool,
) -> Dict[str, Any]:
    """
    B14-AC3 & Failure-to-Prevent:
    A high recall estimate does NOT unlock an unfamiliar DSA readiness claim.
    FSRS measures item retention (declarative/micro recall); only demonstrated,
    verified blank-editor code execution on novel transfer problems establishes readiness.
    """
    recall_retrievability = recall_item.retrievability if recall_item else 0.0
    review_count = recall_item.review_count if recall_item else 0

    if not verified_problem_solving_success:
        # High recall estimate explicitly REJECTED from unlocking readiness
        return {
            "competency_key": competency_key,
            "readiness_unlocked": False,
            "recall_retrievability": recall_retrievability,
            "review_count": review_count,
            "verified_problem_solving_success": False,
            "status": "not_demonstrated",
            "reason": (
                f"High declarative recall estimate (R={recall_retrievability:.2f}, {review_count} reviews) "
                "does not unlock unfamiliar DSA readiness claim; verified independent code execution required (B14-AC3)."
            ),
        }

    return {
        "competency_key": competency_key,
        "readiness_unlocked": True,
        "recall_retrievability": recall_retrievability,
        "review_count": review_count,
        "verified_problem_solving_success": True,
        "status": "demonstrated",
        "reason": "Verified independent problem solving and test execution demonstrated.",
    }


# -----------------------------------------------------------------------------
# Planner Integration Contract (Section 22.1 & 22.2)
# -----------------------------------------------------------------------------

def get_due_recall_tasks_for_planner(
    owner_id: str,
    target_date: str,
    timezone_name: str = "Asia/Kolkata",
    max_items: int = 2,
    max_minutes: int = 15,
) -> List[PlanCommitmentRecord]:
    """
    Finds due micro-recall items and packages them as PlanCommitmentRecords
    enforcing Section 22.1 cap: at most 2 review items and 15 minutes total per day.
    """
    all_items = list_owner_recall_items(owner_id)
    as_of_dt = datetime.strptime(f"{target_date}T23:59:59", "%Y-%m-%dT%H:%M:%S").replace(tzinfo=ZoneInfo(timezone_name))
    as_of_utc = as_of_dt.astimezone(timezone.utc)

    due_items = [
        item for item in all_items
        if is_item_due(item.due_at_utc, as_of_utc, timezone_name=timezone_name)
    ]

    # Sort by earliest due date, then lowest stability (most vulnerable first)
    sorted_due = sorted(
        due_items,
        key=lambda x: (x.due_at_utc, x.stability),
    )

    commitments: List[PlanCommitmentRecord] = []
    total_minutes = 0

    for item in sorted_due[:max_items]:
        if total_minutes + item.expected_minutes <= max_minutes:
            comm = PlanCommitmentRecord(
                id=f"comm_recall_{item.id[:8]}",
                owner_id=owner_id,
                plan_id=f"plan_{owner_id[:8]}",
                activity_id=f"act_recall_{item.id[:8]}",
                competency_key=item.competency_key,
                title=f"Spaced Recall: {item.title}",
                kind=CommitmentKind.CS_RECALL if "cs." in item.competency_key else CommitmentKind.DSA_REVIEW,
                estimate_minutes=item.expected_minutes,
                planned_date=target_date,
                committed_date=target_date,
                original_committed_date=target_date,
                status=CommitmentStatus.PENDING,
                is_carryover=False,
                reason=f"Due FSRS micro-recall review (R={item.retrievability:.2f}, interval {item.stability:.1f}d)",
                generated_key=f"recall:{item.id}:{target_date}",
            )
            commitments.append(comm)
            total_minutes += item.expected_minutes

    return commitments
