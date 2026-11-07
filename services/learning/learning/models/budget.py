"""
Budget Tracker and Atomic Spend Reservation.
Authority: planly-build-sprints-v2/OPERATING_PROFILE.md
Sprint: B06
"""

import math
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

from learning.config import (
    BudgetsConfig,
    load_budgets_config,
    load_models_config,
    get_project_root,
)
from learning.models.types import (
    ReservationStatus,
    ReservationReceipt,
    SettledReceipt,
    BudgetStatusReport,
    BudgetExceededError,
)

_LOCAL_LOCK = threading.Lock()


def get_budget_db_path() -> Path:
    """Returns persistent SQLite path for budget ledger."""
    db_dir = get_project_root() / "services" / "learning" / ".state"
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir / "budget_ledger.db"


class BudgetTracker:
    """
    Manages atomic spend reservations, reconciliation, and uncertain retention.
    Enforces live-learning and background pools independently under the shared ceiling.
    """

    def __init__(
        self,
        config: Optional[BudgetsConfig] = None,
        db_path: Optional[Path] = None,
    ):
        self.config = config or load_budgets_config()
        self.models_config = load_models_config()
        self.db_path = db_path or get_budget_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=20.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with _LOCAL_LOCK, self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS budget_reservations (
                    reservation_id TEXT PRIMARY KEY,
                    pool TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    estimated_cost_cents INTEGER NOT NULL,
                    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_budget_pool_status
                ON budget_reservations (pool, status)
                """
            )
            conn.commit()

    def reset_ledger(self) -> None:
        """For testing only: clears all reservations and settlements."""
        with _LOCAL_LOCK, self._get_connection() as conn:
            conn.execute("DELETE FROM budget_reservations")
            conn.commit()

    def calculate_cost_cents(
        self,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
    ) -> int:
        """
        Calculates cost in integer cents, rounding up to guarantee conservative accounting.
        Default rates for Gemini 3.8 Flash:
        Input: $0.75 / 1M tokens ($0.00000075 / token)
        Output: $3.75 / 1M tokens ($0.00000375 / token)
        """
        model_def = None
        for m in self.models_config.models.values():
            if m.model_name == model_name:
                model_def = m
                break

        if model_def:
            input_rate = model_def.pricing.input_cost_per_m / 1_000_000.0
            output_rate = model_def.pricing.output_cost_per_m / 1_000_000.0
        else:
            input_rate = 0.75 / 1_000_000.0
            output_rate = 3.75 / 1_000_000.0

        usd = (input_tokens * input_rate) + (output_tokens * output_rate)
        # Convert to cents, round up to avoid under-accounting
        cents = math.ceil(usd * 100.0)
        # Guarantee minimum 1 cent if any tokens were billed
        if (input_tokens > 0 or output_tokens > 0) and cents == 0:
            cents = 1
        return cents

    def reserve(
        self,
        pool: str,
        estimated_input_tokens: int,
        estimated_max_output_tokens: int,
        model_name: str = "gemini-3.8-flash",
    ) -> ReservationReceipt:
        """
        Atomically reserves estimated maximum request cost before dispatch.
        Guarantees that concurrent dispatch cannot oversubscribe shared allowance (B06-AC4).
        """
        estimated_cost_cents = self.calculate_cost_cents(
            model_name=model_name,
            input_tokens=estimated_input_tokens,
            output_tokens=estimated_max_output_tokens,
        )

        with _LOCAL_LOCK, self._get_connection() as conn:
            # Check pool allocation
            pool_cfg = self.config.pools.get(pool)
            if not pool_cfg:
                raise ValueError(f"Unknown budget pool: {pool}")

            pool_limit_cents = int(pool_cfg.allocation_usd * 100)
            dispatch_limit_cents = int(self.config.internal_dispatch_limit_usd * 100)

            # Query current active commitments in this pool
            cursor = conn.execute(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_cost_cents ELSE 0 END), 0) as settled,
                    COALESCE(SUM(CASE WHEN status IN ('reserved', 'uncertain') THEN estimated_cost_cents ELSE 0 END), 0) as reserved_or_uncertain
                FROM budget_reservations
                WHERE pool = ?
                """,
                (pool,),
            )
            row = cursor.fetchone()
            pool_settled = row["settled"]
            pool_active = row["reserved_or_uncertain"]
            pool_committed = pool_settled + pool_active

            if pool_committed + estimated_cost_cents > pool_limit_cents and not pool_cfg.allow_overdraft:
                raise BudgetExceededError(
                    f"Pool '{pool}' budget exceeded: attempted {estimated_cost_cents}¢, "
                    f"committed {pool_committed}¢, limit {pool_limit_cents}¢."
                )

            # Query total global commitments across all pools
            cursor = conn.execute(
                """
                SELECT
                    COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_cost_cents ELSE 0 END), 0) as total_settled,
                    COALESCE(SUM(CASE WHEN status IN ('reserved', 'uncertain') THEN estimated_cost_cents ELSE 0 END), 0) as total_reserved
                FROM budget_reservations
                """
            )
            row_total = cursor.fetchone()
            total_committed = row_total["total_settled"] + row_total["total_reserved"]

            if total_committed + estimated_cost_cents > dispatch_limit_cents:
                raise BudgetExceededError(
                    f"Internal dispatch limit exceeded: attempted {estimated_cost_cents}¢, "
                    f"committed {total_committed}¢, ceiling {dispatch_limit_cents}¢."
                )

            reservation_id = f"res_{uuid.uuid4().hex[:12]}"
            now_str = datetime.now(timezone.utc).isoformat()

            conn.execute(
                """
                INSERT INTO budget_reservations (
                    reservation_id, pool, model_name, estimated_cost_cents, actual_cost_cents,
                    status, reason, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?)
                """,
                (
                    reservation_id,
                    pool,
                    model_name,
                    estimated_cost_cents,
                    ReservationStatus.RESERVED.value,
                    now_str,
                    now_str,
                ),
            )
            conn.commit()

            return ReservationReceipt(
                reservation_id=reservation_id,
                pool=pool,
                model_name=model_name,
                estimated_cost_cents=estimated_cost_cents,
                status=ReservationStatus.RESERVED,
                created_at=now_str,
            )

    def reconcile(
        self,
        reservation_id: str,
        actual_input_tokens: int,
        actual_output_tokens: int,
    ) -> SettledReceipt:
        """
        Reconciles actual provider usage, releasing unused reserved headroom.
        """
        with _LOCAL_LOCK, self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM budget_reservations WHERE reservation_id = ?",
                (reservation_id,),
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Reservation {reservation_id} not found")

            actual_cents = self.calculate_cost_cents(
                model_name=row["model_name"],
                input_tokens=actual_input_tokens,
                output_tokens=actual_output_tokens,
            )
            now_str = datetime.now(timezone.utc).isoformat()

            conn.execute(
                """
                UPDATE budget_reservations
                SET actual_cost_cents = ?,
                    status = ?,
                    updated_at = ?
                WHERE reservation_id = ?
                """,
                (
                    actual_cents,
                    ReservationStatus.SETTLED.value,
                    now_str,
                    reservation_id,
                ),
            )
            conn.commit()

            return SettledReceipt(
                reservation_id=reservation_id,
                pool=row["pool"],
                actual_cost_cents=actual_cents,
                status=ReservationStatus.SETTLED,
                tokens_billed=actual_input_tokens + actual_output_tokens,
                settled_at=now_str,
            )

    def mark_uncertain(self, reservation_id: str, reason: str = "Timeout or disconnect") -> None:
        """
        Marks reservation UNCERTAIN and retains the estimated spend against budget.
        Timeout/restart cannot erase reserved spend (B06-AC4).
        """
        with _LOCAL_LOCK, self._get_connection() as conn:
            now_str = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                UPDATE budget_reservations
                SET status = ?,
                    reason = ?,
                    updated_at = ?
                WHERE reservation_id = ?
                """,
                (
                    ReservationStatus.UNCERTAIN.value,
                    reason,
                    now_str,
                    reservation_id,
                ),
            )
            conn.commit()

    def release(self, reservation_id: str, reason: str = "Pre-dispatch failure") -> None:
        """Releases reservation when call was aborted prior to remote network dispatch."""
        with _LOCAL_LOCK, self._get_connection() as conn:
            now_str = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                UPDATE budget_reservations
                SET status = ?,
                    reason = ?,
                    updated_at = ?
                WHERE reservation_id = ?
                """,
                (
                    ReservationStatus.RELEASED.value,
                    reason,
                    now_str,
                    reservation_id,
                ),
            )
            conn.commit()

    def get_budget_status(self) -> BudgetStatusReport:
        """Returns comprehensive real-time status of budget pools and ceilings."""
        with _LOCAL_LOCK, self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT
                    pool,
                    COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_cost_cents ELSE 0 END), 0) as settled_cents,
                    COALESCE(SUM(CASE WHEN status = 'reserved' THEN estimated_cost_cents ELSE 0 END), 0) as reserved_cents,
                    COALESCE(SUM(CASE WHEN status = 'uncertain' THEN estimated_cost_cents ELSE 0 END), 0) as uncertain_cents
                FROM budget_reservations
                GROUP BY pool
                """
            )
            pool_stats = {row["pool"]: row for row in cursor.fetchall()}

            total_settled_cents = sum(r["settled_cents"] for r in pool_stats.values())
            total_reserved_cents = sum(r["reserved_cents"] for r in pool_stats.values())
            total_uncertain_cents = sum(r["uncertain_cents"] for r in pool_stats.values())
            total_committed_cents = total_settled_cents + total_reserved_cents + total_uncertain_cents

            dispatch_limit_cents = int(self.config.internal_dispatch_limit_usd * 100)
            remaining_dispatch_cents = max(0, dispatch_limit_cents - total_committed_cents)

            pools_dict: Dict[str, Dict[str, Any]] = {}
            for pool_name, pool_cfg in self.config.pools.items():
                stats = pool_stats.get(pool_name)
                s = (stats["settled_cents"] if stats else 0) / 100.0
                r = (stats["reserved_cents"] if stats else 0) / 100.0
                u = (stats["uncertain_cents"] if stats else 0) / 100.0
                committed = s + r + u
                pools_dict[pool_name] = {
                    "allocation_usd": pool_cfg.allocation_usd,
                    "settled_usd": s,
                    "reserved_usd": r,
                    "uncertain_usd": u,
                    "remaining_usd": max(0.0, pool_cfg.allocation_usd - committed),
                }

            return BudgetStatusReport(
                monthly_ceiling_usd=self.config.monthly_ceiling_usd,
                internal_dispatch_limit_usd=self.config.internal_dispatch_limit_usd,
                total_settled_usd=total_settled_cents / 100.0,
                total_reserved_usd=total_reserved_cents / 100.0,
                total_uncertain_usd=total_uncertain_cents / 100.0,
                remaining_dispatch_usd=remaining_dispatch_cents / 100.0,
                pools=pools_dict,
            )


# Global singleton instance
_default_tracker: Optional[BudgetTracker] = None


def get_budget_tracker() -> BudgetTracker:
    global _default_tracker
    if _default_tracker is None:
        _default_tracker = BudgetTracker()
    return _default_tracker
