"""
Sprint B28: Observability Metrics, Latency Targets & Spend Tracking
Authority: PLANLY_BUILD_SPEC.md §4, §12, §15; OPERATING_PROFILE.md; B28_deploy_operations.md

Enforces:
- B28-AC3: Record acknowledgement/feedback p50/p95 and costs against proposed pilot targets; disclose misses.
- Trace IDs, versions, timings, and spend without exporting full private student payloads.
"""

from typing import List, Dict, Any, Optional
import math
from pydantic import BaseModel, Field
from datetime import datetime, timezone


class LatencyReport(BaseModel):
    sample_count: int
    ack_p50_ms: float
    ack_p95_ms: float
    feedback_p50_ms: float
    feedback_p95_ms: float
    ack_p50_target_ms: float = 150.0
    ack_p95_target_ms: float = 500.0
    feedback_p50_target_ms: float = 2500.0
    feedback_p95_target_ms: float = 6000.0
    target_misses: List[str] = Field(default_factory=list)


class ProviderCostRecord(BaseModel):
    provider: str
    cost_usd: float
    tokens_in: int = 0
    tokens_out: int = 0
    invocations: int = 1
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CostSummaryReport(BaseModel):
    monthly_ceiling_usd: float = 10.00
    total_spent_usd: float
    remaining_usd: float
    percent_consumed: float
    provider_breakdown: Dict[str, float]
    sandbox_metered_usd: float
    model_inference_usd: float
    disclosed_budget_warning: bool = False


class MetricsTracker:
    """
    In-memory metrics tracker for latency percentiles and cost monitoring.
    Enforces student privacy by rejecting prompt or code payload retention.
    """

    def __init__(self, monthly_ceiling_usd: float = 10.00):
        self.monthly_ceiling_usd = monthly_ceiling_usd
        self._ack_latencies: List[float] = []
        self._feedback_latencies: List[float] = []
        self._cost_records: List[ProviderCostRecord] = []

    def reset(self):
        self._ack_latencies.clear()
        self._feedback_latencies.clear()
        self._cost_records.clear()

    def record_acknowledgement_latency(self, duration_ms: float, trace_id: Optional[str] = None):
        """Records initial run acknowledgment time (HTTP 200/receipt)."""
        self._ack_latencies.append(float(duration_ms))

    def record_feedback_latency(self, duration_ms: float, trace_id: Optional[str] = None):
        """Records end-to-end feedback delivery latency."""
        self._feedback_latencies.append(float(duration_ms))

    def record_spend(
        self,
        provider: str,
        cost_usd: float,
        tokens_in: int = 0,
        tokens_out: int = 0,
        **kwargs,
    ):
        """
        Records provider spend.
        B28-AC3: Drops any passed 'prompt', 'code', or 'content' kwargs to preserve student privacy.
        """
        # Strictly ignore private payloads if accidentally passed
        clean_provider = str(provider).lower().strip()
        rec = ProviderCostRecord(
            provider=clean_provider,
            cost_usd=round(float(cost_usd), 6),
            tokens_in=int(tokens_in),
            tokens_out=int(tokens_out),
        )
        self._cost_records.append(rec)

    @staticmethod
    def _compute_percentile(data: List[float], percentile: float) -> float:
        if not data:
            return 0.0
        sorted_data = sorted(data)
        k = (len(sorted_data) - 1) * (percentile / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return round(sorted_data[int(k)], 2)
        d0 = sorted_data[int(f)] * (c - k)
        d1 = sorted_data[int(c)] * (k - f)
        return round(d0 + d1, 2)

    def get_latency_report(self) -> LatencyReport:
        """
        B28-AC3: Computes p50/p95 for ack and feedback, disclosing any target misses.
        """
        ack_p50 = self._compute_percentile(self._ack_latencies, 50.0)
        ack_p95 = self._compute_percentile(self._ack_latencies, 95.0)
        fb_p50 = self._compute_percentile(self._feedback_latencies, 50.0)
        fb_p95 = self._compute_percentile(self._feedback_latencies, 95.0)

        misses = []
        if self._ack_latencies and ack_p50 > 150.0:
            misses.append(f"Acknowledgment p50 ({ack_p50}ms) exceeded target (150ms)")
        if self._ack_latencies and ack_p95 > 500.0:
            misses.append(f"Acknowledgment p95 ({ack_p95}ms) exceeded target (500ms)")
        if self._feedback_latencies and fb_p50 > 2500.0:
            misses.append(f"Feedback p50 ({fb_p50}ms) exceeded target (2500ms)")
        if self._feedback_latencies and fb_p95 > 6000.0:
            misses.append(f"Feedback p95 ({fb_p95}ms) exceeded target (6000ms)")

        return LatencyReport(
            sample_count=max(len(self._ack_latencies), len(self._feedback_latencies)),
            ack_p50_ms=ack_p50,
            ack_p95_ms=ack_p95,
            feedback_p50_ms=fb_p50,
            feedback_p95_ms=fb_p95,
            target_misses=misses,
        )

    def get_cost_summary(self) -> CostSummaryReport:
        """
        B28-AC3: Computes provider cost breakdown against $10/mo ceiling.
        """
        breakdown: Dict[str, float] = {}
        sandbox_total = 0.0
        model_total = 0.0

        for r in self._cost_records:
            breakdown[r.provider] = round(breakdown.get(r.provider, 0.0) + r.cost_usd, 4)
            if "e2b" in r.provider or "sandbox" in r.provider:
                sandbox_total += r.cost_usd
            elif "gemini" in r.provider or "model" in r.provider:
                model_total += r.cost_usd

        total_spent = round(sum(breakdown.values()), 4)
        remaining = max(0.0, round(self.monthly_ceiling_usd - total_spent, 4))
        percent = round((total_spent / self.monthly_ceiling_usd) * 100.0, 2)

        return CostSummaryReport(
            monthly_ceiling_usd=self.monthly_ceiling_usd,
            total_spent_usd=total_spent,
            remaining_usd=remaining,
            percent_consumed=percent,
            provider_breakdown=breakdown,
            sandbox_metered_usd=round(sandbox_total, 4),
            model_inference_usd=round(model_total, 4),
            disclosed_budget_warning=(percent >= 80.0),
        )


_global_tracker: Optional[MetricsTracker] = None


def get_metrics_tracker() -> MetricsTracker:
    global _global_tracker
    if _global_tracker is None:
        _global_tracker = MetricsTracker()
    return _global_tracker
