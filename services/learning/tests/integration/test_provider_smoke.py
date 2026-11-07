"""
Real Provider Integration Smoke Test.
Sprint: B06
Requirement B06-AC1: One small real tutor call returns schema-valid output and recorded usage;
credential absence is NOT_RUN, never passed.
Requirement B06-AC3: Deterministic adapter tests are kept distinct from real-provider smoke result.
"""

import os
import sys
from pathlib import Path

# Add services/learning to path
LEARNING_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(LEARNING_DIR))

from learning.domain.contracts import TeachingDecision
from learning.models.gateway import ModelGateway
from learning.models.budget import BudgetTracker
from learning.models.types import ProviderCredentialMissingError


def run_provider_smoke() -> None:
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("\n=======================================================")
        print("B06-AC1 REAL PROVIDER SMOKE RESULT: NOT_RUN")
        print("Reason: GEMINI_API_KEY environment variable is absent.")
        print("Rule: Credential absence is NOT_RUN, never passed.")
        print("=======================================================\n")
        return

    print("\n=======================================================")
    print("B06-AC1: Executing small real tutor call to Gemini...")
    print("=======================================================")

    # Use a temporary test budget ledger
    test_db = LEARNING_DIR / ".state" / "smoke_budget.db"
    if test_db.exists():
        test_db.unlink()

    tracker = BudgetTracker(db_path=test_db)
    gateway = ModelGateway(budget_tracker=tracker)

    prompt = (
        "Learner submitted initial two-pointer solution for reversing a list. "
        "Provide a 1-sentence assessment and recommend advancing to next step."
    )

    try:
        decision, response = gateway.generate_structured(
            prompt=prompt,
            response_schema=TeachingDecision,
            role="tutor",
            pool="live_learning",
            estimated_input_tokens=150,
            estimated_max_output_tokens=300,
        )

        assert isinstance(decision, TeachingDecision), "Output must be instance of TeachingDecision"
        assert decision.decision_id is not None, "Decision must have decision_id"
        assert response.usage.total_tokens > 0, "Real token usage must be non-zero"
        assert response.usage.cost_cents >= 0, "Cost must be calculated"
        assert response.continuation_metadata.get("finish_reason") is not None, "Continuation metadata required"

        print(f"Real call succeeded! Model: {response.model_name}")
        print(f"Decision ID: {decision.decision_id}")
        print(f"Assessment: {decision.assessment}")
        print(f"Tokens billed: {response.usage.total_tokens} (cost: {response.usage.cost_cents}¢)")
        print(f"Continuation metadata: {response.continuation_metadata}")
        print("B06-AC1 REAL PROVIDER SMOKE: PASSED")

    except Exception as e:
        print(f"Real provider smoke failed with error: {e}")
        raise e
    finally:
        if test_db.exists():
            test_db.unlink()


if __name__ == "__main__":
    run_provider_smoke()
