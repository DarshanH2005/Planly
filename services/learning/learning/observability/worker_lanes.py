"""
Sprint B28: Worker Lanes & Tutoring Capacity Protection
Authority: PLANLY_BUILD_SPEC.md §4, §12; B28_deploy_operations.md

Enforces:
- B28-AC2: Background import does not consume all tutoring capacity.
- Isolated priority lanes preventing bulk ingestion from starving live lesson turns.
"""

from enum import Enum
from typing import Dict, Any, Callable, Optional, List
import threading
import queue
import time


class WorkerLane(str, Enum):
    INTERACTIVE = "interactive"  # Live classroom tutoring, step evaluation, code execution
    BACKGROUND = "background"    # Bulk chat import, embedding indexation, maintenance


class CapacityExhaustedError(Exception):
    pass


class WorkerLaneManager:
    """
    Manages concurrent worker slots divided into isolated priority lanes.
    Ensures background jobs (B05 chat import, repository indexing) never starve
    or exhaust interactive tutoring capacity (B28-AC2).
    """

    def __init__(self, interactive_capacity: int = 4, background_capacity: int = 1):
        self.interactive_capacity = interactive_capacity
        self.background_capacity = background_capacity

        self._interactive_active = 0
        self._background_active = 0
        self._background_queue: List[str] = []
        self._lock = threading.Lock()

    def get_capacity_status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "interactive": {
                    "capacity": self.interactive_capacity,
                    "active": self._interactive_active,
                    "available": max(0, self.interactive_capacity - self._interactive_active),
                },
                "background": {
                    "capacity": self.background_capacity,
                    "active": self._background_active,
                    "queued": len(self._background_queue),
                    "available": max(0, self.background_capacity - self._background_active),
                },
            }

    def can_acquire_interactive(self) -> bool:
        with self._lock:
            return self._interactive_active < self.interactive_capacity

    def acquire_slot(self, lane: WorkerLane, job_id: str) -> bool:
        """
        Attempts to acquire a slot in the specified lane.
        B28-AC2: Interactive slots are strictly segregated from background slots.
        """
        with self._lock:
            if lane == WorkerLane.INTERACTIVE:
                if self._interactive_active < self.interactive_capacity:
                    self._interactive_active += 1
                    return True
                return False

            elif lane == WorkerLane.BACKGROUND:
                if self._background_active < self.background_capacity:
                    self._background_active += 1
                    return True
                else:
                    if job_id not in self._background_queue:
                        self._background_queue.append(job_id)
                    return False

            return False

    def release_slot(self, lane: WorkerLane, job_id: str):
        with self._lock:
            if lane == WorkerLane.INTERACTIVE:
                if self._interactive_active > 0:
                    self._interactive_active -= 1

            elif lane == WorkerLane.BACKGROUND:
                if self._background_active > 0:
                    self._background_active -= 1
                if job_id in self._background_queue:
                    self._background_queue.remove(job_id)

    def execute_with_lane(
        self,
        lane: WorkerLane,
        job_id: str,
        action: Callable[[], Any],
    ) -> Any:
        """
        Executes an action within the designated worker lane.
        Raises CapacityExhaustedError if interactive slots are full.
        Queues background jobs if background slot is occupied.
        """
        acquired = self.acquire_slot(lane, job_id)
        if not acquired:
            if lane == WorkerLane.INTERACTIVE:
                raise CapacityExhaustedError(
                    f"Interactive tutoring capacity ({self.interactive_capacity}) full; try again."
                )
            else:
                # Background job queued
                return {"job_id": job_id, "status": "queued", "lane": "background"}

        try:
            return action()
        finally:
            self.release_slot(lane, job_id)


_global_lane_manager: Optional[WorkerLaneManager] = None


def get_lane_manager() -> WorkerLaneManager:
    global _global_lane_manager
    if _global_lane_manager is None:
        _global_lane_manager = WorkerLaneManager()
    return _global_lane_manager
