"""
Deterministic Fixture Model Provider Adapter.
VISIBLY LABELED DETERMINISTIC TEST FIXTURE ONLY.
Enforces B06-AC3: Deterministic adapter tests kept distinct from real-provider smoke result.
Sprint: B06
"""

import json
from typing import Optional, Dict, Any, Type
from pydantic import BaseModel

from learning.models.providers.base import BaseModelProvider
from learning.models.types import (
    ProviderResponse,
    TokenUsage,
    ProviderQuotaExceededError,
    ProviderTimeoutError,
    MissingContinuationMetadataError,
)


class FixtureModelProvider(BaseModelProvider):
    """
    Deterministic mock provider for unit and boundary tests.
    Explicitly labeled as fixture. Does not call any external network or spend budget.
    """

    def __init__(
        self,
        model_name: str = "fixture-tutor",
        config: Optional[Dict[str, Any]] = None,
        default_content: str = "Deterministic fixture tutor response.",
        default_structured: Optional[Dict[str, Any]] = None,
        prompt_tokens: int = 150,
        completion_tokens: int = 80,
    ):
        super().__init__(model_name=model_name, config=config)
        self.default_content = default_content
        self.default_structured = default_structured
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens

        # Controllable fault injection switches for boundary tests
        self.simulate_timeout: bool = False
        self.simulate_quota: bool = False
        self.simulate_malformed: bool = False
        self.simulate_schema_violation: bool = False
        self.simulate_missing_metadata: bool = False
        self.repair_attempt_counter: int = 0
        self.succeed_on_repair: bool = False

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 2048,
        timeout_seconds: int = 30,
        **kwargs,
    ) -> ProviderResponse:
        if self.simulate_timeout:
            raise ProviderTimeoutError("Simulated fixture timeout (B06-AC2)")

        if self.simulate_quota:
            raise ProviderQuotaExceededError("Simulated fixture quota exceeded HTTP 429 (B06-AC2)")

        usage = TokenUsage(
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            thinking_tokens=10,
            total_tokens=self.prompt_tokens + self.completion_tokens,
            cost_cents=0,
        )

        continuation_metadata: Dict[str, Any] = {
            "finish_reason": "STOP",
            "model_version": self.model_name,
            "fixture_labeled": True,
        }
        if self.simulate_missing_metadata:
            continuation_metadata = {}

        return ProviderResponse(
            content=self.default_content,
            structured_data=self.default_structured,
            model_name=self.model_name,
            usage=usage,
            continuation_metadata=continuation_metadata,
            latency_ms=15,
            provider_receipt=f"fixture_rcpt_{self.model_name}",
        )

    def generate_structured(
        self,
        prompt: str,
        response_schema: Type[BaseModel],
        system_prompt: Optional[str] = None,
        temperature: float = 0.1,
        max_output_tokens: int = 2048,
        timeout_seconds: int = 30,
        **kwargs,
    ) -> ProviderResponse:
        if self.simulate_timeout:
            raise ProviderTimeoutError("Simulated fixture timeout (B06-AC2)")

        if self.simulate_quota:
            raise ProviderQuotaExceededError("Simulated fixture quota exceeded HTTP 429 (B06-AC2)")

        if self.simulate_malformed:
            if self.succeed_on_repair and self.repair_attempt_counter > 0:
                # Succeeded on bounded repair!
                pass
            else:
                self.repair_attempt_counter += 1
                usage = TokenUsage(
                    prompt_tokens=self.prompt_tokens,
                    completion_tokens=self.completion_tokens,
                    total_tokens=self.prompt_tokens + self.completion_tokens,
                    cost_cents=0,
                )
                return ProviderResponse(
                    content="{ malformed json [ unclosed",
                    structured_data=None,
                    model_name=self.model_name,
                    usage=usage,
                    continuation_metadata={"finish_reason": "STOP", "fixture_labeled": True},
                    latency_ms=10,
                    provider_receipt="fixture_malformed_receipt",
                )

        if self.simulate_schema_violation:
            if self.succeed_on_repair and self.repair_attempt_counter > 0:
                pass
            else:
                self.repair_attempt_counter += 1
                usage = TokenUsage(
                    prompt_tokens=self.prompt_tokens,
                    completion_tokens=self.completion_tokens,
                    total_tokens=self.prompt_tokens + self.completion_tokens,
                    cost_cents=0,
                )
                return ProviderResponse(
                    content=json.dumps({"completely_unrelated_field": "test"}),
                    structured_data={"completely_unrelated_field": "test"},
                    model_name=self.model_name,
                    usage=usage,
                    continuation_metadata={"finish_reason": "STOP", "fixture_labeled": True},
                    latency_ms=10,
                    provider_receipt="fixture_violation_receipt",
                )

        # Default valid structured output
        if self.default_structured:
            data = self.default_structured
        else:
            # Build sample data conforming to schema if possible
            data = {
                "decision_id": "dec_fixture_001",
                "session_id": "sess_001",
                "owner_id": "00000000-0000-0000-0000-000000000001",
                "expected_revision": 1,
                "assessment": "Learner demonstrates solid grasp of pointer initialization.",
                "uncertainty": 0.1,
                "next_action": "advance",
                "reveal_limit": 0,
                "observed_success_criteria": ["handles_empty_input", "pointers_converge"],
                "rationale": "Code passes boundary check and runs O(n) time.",
                "model_version": self.model_name,
            }

        usage = TokenUsage(
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
            thinking_tokens=15,
            total_tokens=self.prompt_tokens + self.completion_tokens,
            cost_cents=0,
        )

        continuation_metadata: Dict[str, Any] = {
            "finish_reason": "STOP",
            "model_version": self.model_name,
            "fixture_labeled": True,
        }
        if self.simulate_missing_metadata:
            continuation_metadata = {}

        return ProviderResponse(
            content=json.dumps(data),
            structured_data=data,
            model_name=self.model_name,
            usage=usage,
            continuation_metadata=continuation_metadata,
            latency_ms=12,
            provider_receipt=f"fixture_structured_rcpt_{self.model_name}",
        )
