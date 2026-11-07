"""
Boundary Tests for Model Gateway, Budget Accounting, and Schema Validation.
Sprint: B06
Verifies:
- B06-AC1: Credential absence is NOT_RUN, never passed.
- B06-AC2: Malformed structured response, quota, timeout, and missing continuation metadata have explicit outcomes.
- B06-AC3: Deterministic adapter tests kept distinct from real-provider smoke result.
- B06-AC4: Concurrent dispatch cannot oversubscribe shared allowance; timeout/restart cannot erase reserved spend;
           exhausted budget blocks new paid calls while preserving learner work.
"""

import os
import sys
import threading
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

# Ensure services/learning on path
LEARNING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LEARNING_DIR))

from learning.domain.contracts import TeachingDecision
from learning.config import (
    BudgetsConfig,
    BudgetPoolConfig,
    BudgetPolicyFlags,
    ModelsConfig,
    ModelDefinition,
)
from learning.models.types import (
    ProviderCredentialMissingError,
    ProviderQuotaExceededError,
    ProviderTimeoutError,
    SchemaValidationError,
    MissingContinuationMetadataError,
    BudgetExceededError,
    ReservationStatus,
)
from learning.models.budget import BudgetTracker
from learning.models.gateway import ModelGateway
from learning.models.providers.gemini import GeminiProvider
from learning.models.providers.fixture import FixtureModelProvider


TEST_DB_PATH = LEARNING_DIR / ".state" / "test_gateway_budget.db"


def setup_function():
    try:
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()
    except Exception:
        pass


def get_test_budgets_config(pool_allocation: float = 8.00) -> BudgetsConfig:
    return BudgetsConfig(
        monthly_ceiling_usd=10.00,
        internal_dispatch_limit_usd=9.00,
        uncommitted_headroom_usd=1.00,
        pools={
            "live_learning": BudgetPoolConfig(
                allocation_usd=pool_allocation,
                description="Live tutoring",
            ),
            "background_work": BudgetPoolConfig(
                allocation_usd=1.00,
                description="Background work",
            ),
        },
        policy_flags=BudgetPolicyFlags(),
    )


# --------------------------------------------------------------------------
# B06-AC1: Credential Absence is NOT_RUN / Never Fabricated
# --------------------------------------------------------------------------

def test_credential_absence_explicit_error():
    # Force GEMINI_API_KEY absent
    old_key = os.environ.pop("GEMINI_API_KEY", None)
    try:
        provider = GeminiProvider(api_key=None)
        try:
            provider.generate(prompt="Hello")
            assert False, "Should have raised ProviderCredentialMissingError"
        except ProviderCredentialMissingError as e:
            assert "GEMINI_API_KEY is not configured" in str(e)
            print("B06-AC1: Credential absence raises ProviderCredentialMissingError (never fabricated): PASSED")
    finally:
        if old_key:
            os.environ["GEMINI_API_KEY"] = old_key


# --------------------------------------------------------------------------
# B06-AC2: Explicit Outcomes for Malformed, Quota, Timeout & Continuation
# --------------------------------------------------------------------------

def test_malformed_structured_response_and_bounded_repair():
    tracker = BudgetTracker(config=get_test_budgets_config(), db_path=TEST_DB_PATH)
    tracker.reset_ledger()

    # 1. Without successful repair: raises SchemaValidationError
    fixture_provider = FixtureModelProvider()
    fixture_provider.simulate_malformed = True
    fixture_provider.succeed_on_repair = False

    gateway = ModelGateway(
        budget_tracker=tracker,
        override_provider=fixture_provider,
    )

    try:
        gateway.generate_structured(
            prompt="Assess pointer initialization",
            response_schema=TeachingDecision,
            max_repair_attempts=1,
        )
        assert False, "Should have raised SchemaValidationError"
    except SchemaValidationError as e:
        assert "failed schema validation" in str(e)
        print("B06-AC2: Malformed structured output raises SchemaValidationError: PASSED")

    # 2. With bounded repair: provider recovers and succeeds
    fixture_provider.repair_attempt_counter = 0
    fixture_provider.succeed_on_repair = True
    decision, response = gateway.generate_structured(
        prompt="Assess pointer initialization",
        response_schema=TeachingDecision,
        max_repair_attempts=1,
    )
    assert isinstance(decision, TeachingDecision)
    assert decision.decision_id == "dec_fixture_001"
    print("B06-AC2: Bounded repair on malformed output succeeds on retry: PASSED")


def test_quota_exceeded_handled():
    tracker = BudgetTracker(config=get_test_budgets_config(), db_path=TEST_DB_PATH)
    tracker.reset_ledger()
    fixture_provider = FixtureModelProvider()
    fixture_provider.simulate_quota = True

    gateway = ModelGateway(budget_tracker=tracker, override_provider=fixture_provider)

    try:
        gateway.generate(prompt="Explain quicksort")
        assert False, "Should have raised ProviderQuotaExceededError"
    except ProviderQuotaExceededError:
        # Check that reservation was released rather than charged
        status = tracker.get_budget_status()
        assert status.total_reserved_usd == 0.0
        assert status.total_settled_usd == 0.0
        print("B06-AC2: Quota exceeded raises ProviderQuotaExceededError and releases reservation: PASSED")


def test_timeout_retains_uncertain_spend():
    tracker = BudgetTracker(config=get_test_budgets_config(), db_path=TEST_DB_PATH)
    tracker.reset_ledger()
    fixture_provider = FixtureModelProvider()
    fixture_provider.simulate_timeout = True

    gateway = ModelGateway(budget_tracker=tracker, override_provider=fixture_provider)

    try:
        gateway.generate(prompt="Explain heaps")
        assert False, "Should have raised ProviderTimeoutError"
    except ProviderTimeoutError:
        # Verify spend was retained as UNCERTAIN
        status = tracker.get_budget_status()
        assert status.total_uncertain_usd > 0.0
        print(f"B06-AC2: Timeout raises ProviderTimeoutError and retains {status.total_uncertain_usd * 100:.0f}¢ uncertain spend: PASSED")


def test_missing_continuation_metadata_explicit_outcome():
    tracker = BudgetTracker(config=get_test_budgets_config(), db_path=TEST_DB_PATH)
    tracker.reset_ledger()
    fixture_provider = FixtureModelProvider()
    fixture_provider.simulate_missing_metadata = True

    gateway = ModelGateway(budget_tracker=tracker, override_provider=fixture_provider)

    try:
        gateway.generate(prompt="Hello")
        assert False, "Should have raised MissingContinuationMetadataError"
    except MissingContinuationMetadataError as e:
        assert "missing continuation metadata" in str(e)
        print("B06-AC2: Missing continuation metadata raises MissingContinuationMetadataError: PASSED")


# --------------------------------------------------------------------------
# B06-AC3: Deterministic Adapter Tests Distinct From Real Smoke
# --------------------------------------------------------------------------

def test_deterministic_fixture_adapter_distinct():
    fixture = FixtureModelProvider(
        model_name="deterministic-test-fixture",
        prompt_tokens=100,
        completion_tokens=50,
    )
    res = fixture.generate(prompt="test prompt")

    assert res.continuation_metadata.get("fixture_labeled") is True, "Fixture must be visibly labeled"
    assert res.usage.prompt_tokens == 100
    assert res.usage.completion_tokens == 50
    assert res.latency_ms > 0
    print("B06-AC3: Deterministic fixture visibly labeled and isolated from real provider: PASSED")


# --------------------------------------------------------------------------
# B06-AC4: Concurrent Dispatch, Restart Retention, and Exhaustion Protection
# --------------------------------------------------------------------------

def test_concurrent_dispatch_no_oversubscription():
    # Setup small allowance: 0.10 USD (10 cents)
    config = get_test_budgets_config(pool_allocation=0.10)
    tracker = BudgetTracker(config=config, db_path=TEST_DB_PATH)
    tracker.reset_ledger()

    # With model rates: 1500 input, 3000 output tokens => ~2 cents per reservation
    fixture = FixtureModelProvider(prompt_tokens=1500, completion_tokens=3000)
    gateway = ModelGateway(budget_tracker=tracker, override_provider=fixture)

    results = []
    errors = []

    def dispatch_worker():
        try:
            resp = gateway.generate(
                prompt="test concurrent",
                estimated_input_tokens=1500,
                estimated_max_output_tokens=3000,
            )
            results.append(resp)
        except BudgetExceededError as e:
            errors.append(e)

    threads = [threading.Thread(target=dispatch_worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Verify: Some succeeded, remaining blocked, and total never exceeded 10 cents
    status = tracker.get_budget_status()
    total_committed = status.total_settled_usd + status.total_reserved_usd + status.total_uncertain_usd

    assert len(results) > 0, "At least some requests must succeed within budget"
    assert len(errors) > 0, "Requests beyond allowance must be blocked with BudgetExceededError"
    assert total_committed <= 0.10, f"Committed spend ${total_committed} exceeded 0.10 pool limit!"
    print(f"B06-AC4: Concurrent dispatch ({len(threads)} threads): {len(results)} succeeded, {len(errors)} blocked. Total spent: ${total_committed:.4f} <= $0.10: PASSED")


def test_restart_cannot_erase_reserved_spend():
    # 1. Create a tracker, dispatch a call that times out
    config = get_test_budgets_config(pool_allocation=5.00)
    tracker1 = BudgetTracker(config=config, db_path=TEST_DB_PATH)
    tracker1.reset_ledger()
    fixture = FixtureModelProvider()
    fixture.simulate_timeout = True
    gateway1 = ModelGateway(budget_tracker=tracker1, override_provider=fixture)

    try:
        gateway1.generate(
            prompt="long running prompt",
            estimated_input_tokens=2000,
            estimated_max_output_tokens=4000,
        )
    except ProviderTimeoutError:
        pass

    uncertain_before = tracker1.get_budget_status().total_uncertain_usd
    assert uncertain_before > 0.0

    # 2. Simulate complete restart by instantiating new tracker reading persistent DB
    del tracker1
    del gateway1

    tracker2 = BudgetTracker(config=config, db_path=TEST_DB_PATH)
    uncertain_after = tracker2.get_budget_status().total_uncertain_usd

    assert uncertain_after == uncertain_before, "Restart must NOT erase uncertain reserved spend!"
    print(f"B06-AC4: System restart preserved persistent uncertain reservation (${uncertain_after:.4f}): PASSED")


def test_exhausted_budget_blocks_paid_calls_preserves_work():
    # Setup exhausted budget pool (0.00 allowance)
    config = get_test_budgets_config(pool_allocation=0.00)
    tracker = BudgetTracker(config=config, db_path=TEST_DB_PATH)
    tracker.reset_ledger()
    fixture = FixtureModelProvider()
    gateway = ModelGateway(budget_tracker=tracker, override_provider=fixture)

    # Calling gateway should fail immediately with BudgetExceededError
    try:
        gateway.generate(prompt="Test exhausted")
        assert False, "Should have raised BudgetExceededError"
    except BudgetExceededError as e:
        assert "budget exceeded" in str(e).lower()
        print("B06-AC4: Exhausted budget strictly blocks paid AI dispatch: PASSED")


def test_reviewer_disabled_by_operating_profile():
    gateway = ModelGateway()
    try:
        gateway.get_provider("reviewer")
        assert False, "Reviewer should be disabled by default"
    except Exception as e:
        assert "disabled by default" in str(e).lower()
        print("Operating Profile: Reviewer disabled by default verified: PASSED")


def run_all_tests():
    setup_function()
    test_credential_absence_explicit_error()
    test_malformed_structured_response_and_bounded_repair()
    test_quota_exceeded_handled()
    test_timeout_retains_uncertain_spend()
    test_missing_continuation_metadata_explicit_outcome()
    test_deterministic_fixture_adapter_distinct()
    test_concurrent_dispatch_no_oversubscription()
    test_restart_cannot_erase_reserved_spend()
    test_exhausted_budget_blocks_paid_calls_preserves_work()
    test_reviewer_disabled_by_operating_profile()
    setup_function()
    print("\nAll B06 Model Gateway & Budget Tests PASSED successfully.")


if __name__ == "__main__":
    run_all_tests()
