"""
Unified Model Gateway with Budget Enforcement and Schema Validation.
Sprint: B06
Authority: planly-build-sprints-v2/OPERATING_PROFILE.md
"""

import json
import logging
from typing import Optional, Dict, Any, Type, TypeVar
from pydantic import BaseModel, ValidationError

from learning.config import (
    ModelsConfig,
    BudgetsConfig,
    load_models_config,
    load_budgets_config,
)
from learning.models.types import (
    ProviderResponse,
    TokenUsage,
    ReservationReceipt,
    BudgetExceededError,
    SchemaValidationError,
    ProviderTimeoutError,
    ProviderQuotaExceededError,
    ProviderCredentialMissingError,
    MissingContinuationMetadataError,
    ModelGatewayError,
    UncertainCallError,
)
from learning.models.budget import BudgetTracker, get_budget_tracker
from learning.models.providers.base import BaseModelProvider
from learning.models.providers.gemini import GeminiProvider
from learning.models.providers.openai import OpenAIProvider
from learning.models.providers.fixture import FixtureModelProvider
from learning.models.routing import ModelRouter, ModelTask
from learning.repositories.provider_credentials import get_provider_api_key

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger(__name__)


class ModelGateway:
    """
    Unified entry point for AI model invocations in Planly.
    - Manages atomic budget reservations before dispatch.
    - Reconciles actual token usage and retains uncertain spend on timeout.
    - Enforces schema validation with bounded repair.
    - Respects operating profile flags (reviewer disabled by default).
    """

    def __init__(
        self,
        models_config: Optional[ModelsConfig] = None,
        budgets_config: Optional[BudgetsConfig] = None,
        budget_tracker: Optional[BudgetTracker] = None,
        override_provider: Optional[BaseModelProvider] = None,
    ):
        self.models_config = models_config or load_models_config()
        self.budgets_config = budgets_config or load_budgets_config()
        self.budget_tracker = budget_tracker or get_budget_tracker()
        self._override_provider = override_provider
        self.router = ModelRouter(self.models_config)

        # Default provider adapters
        self._providers: Dict[str, BaseModelProvider] = {}
        self._init_providers()

    def _init_providers(self) -> None:
        for key, definition in self.models_config.models.items():
            if not definition.enabled or definition.provider == "external":
                continue
            provider = self._build_provider(key)
            if provider:
                self._providers[key] = provider

    def _build_provider(self, key: str, api_key: Optional[str] = None) -> Optional[BaseModelProvider]:
        definition = self.models_config.models.get(key)
        if not definition or not definition.enabled or definition.provider == "external":
            return None
        params = definition.parameters
        provider_config = {
            "endpoint_model": definition.model_name,
            "temperature": params.temperature,
            "max_output_tokens": params.max_output_tokens,
            "timeout_seconds": params.timeout_seconds,
            "reasoning_effort": params.reasoning_effort,
        }
        if definition.provider == "gemini":
            return GeminiProvider(model_name=definition.model_name, api_key=api_key, config=provider_config)
        if definition.provider == "openai":
            return OpenAIProvider(model_name=definition.model_name, api_key=api_key, config=provider_config)
        logger.warning("Ignoring unsupported model provider '%s' for '%s'", definition.provider, key)
        return None

    def _route_candidates(
        self,
        role: str,
        task: Optional[ModelTask | str],
        preferred: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> list[str]:
        if role == "reviewer":
            # Premium reviewer access is an explicit policy decision. Never
            # silently substitute the tutor when that role is disabled.
            return [preferred or role]
        if task is None:
            return [preferred or role]
        return self.router.candidates(task, preferred=preferred, owner_id=owner_id)

    def get_provider(
        self,
        role: str = "tutor",
        task: Optional[ModelTask | str] = None,
        model_key: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> BaseModelProvider:
        if self._override_provider:
            return self._override_provider

        if role == "reviewer" and (task is None or model_key == "reviewer"):
            reviewer_def = self.models_config.models.get("reviewer")
            if not reviewer_def or not reviewer_def.enabled:
                raise ModelGatewayError(
                    "Reviewer model is disabled by default in the current budget profile. "
                    "Automatic premium review is disabled per OPERATING_PROFILE.md."
                )

        selected_key = model_key or (self._route_candidates(role, task, owner_id=owner_id)[0] if task else role)
        if owner_id:
            definition = self.models_config.models.get(selected_key)
            if definition and definition.provider in {"gemini", "openai"}:
                owner_key = get_provider_api_key(owner_id, definition.provider)
                if owner_key:
                    owner_provider = self._build_provider(selected_key, api_key=owner_key)
                    if owner_provider:
                        return owner_provider
        provider = self._providers.get(selected_key)
        if not provider:
            raise ModelGatewayError(f"No provider configured for model route '{selected_key}'")
        return provider

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Extracts JSON from text, handling markdown fences and whitespace."""
        s = text.strip()
        if s.startswith("```json"):
            s = s[7:]
        if s.startswith("```"):
            s = s[3:]
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
        try:
            return json.loads(s)
        except Exception:
            # Fallback: find first { and last }
            start = s.find("{")
            end = s.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(s[start : end + 1])
                except Exception:
                    pass
        return None

    def generate(
        self,
        prompt: str,
        role: str = "tutor",
        pool: str = "live_learning",
        system_prompt: Optional[str] = None,
        estimated_input_tokens: int = 500,
        estimated_max_output_tokens: int = 1000,
        task: Optional[ModelTask | str] = None,
        owner_id: Optional[str] = None,
        **kwargs,
    ) -> ProviderResponse:
        """Executes routed text generation under atomic budget reservation."""
        candidates = self._route_candidates(role, task, owner_id=owner_id)
        last_error: Optional[Exception] = None
        for model_key in candidates:
            try:
                return self._generate_once(
                    prompt=prompt, role=role, pool=pool, system_prompt=system_prompt,
                    estimated_input_tokens=estimated_input_tokens,
                    estimated_max_output_tokens=estimated_max_output_tokens,
                    model_key=model_key, owner_id=owner_id, **kwargs,
                )
            except (ProviderCredentialMissingError, ProviderQuotaExceededError, BudgetExceededError) as exc:
                last_error = exc
                logger.warning("Model route '%s' unavailable for %s: %s", model_key, task or role, exc)
                continue
        if last_error:
            raise last_error
        raise ModelGatewayError(f"No usable model route configured for '{task or role}'")

    def _generate_once(
        self,
        prompt: str,
        role: str,
        pool: str,
        system_prompt: Optional[str],
        estimated_input_tokens: int,
        estimated_max_output_tokens: int,
        model_key: Optional[str] = None,
        owner_id: Optional[str] = None,
        **kwargs,
    ) -> ProviderResponse:
        provider = self.get_provider(role=role, model_key=model_key, owner_id=owner_id)
        model_name = provider.model_name

        # 1. Atomically reserve estimated max spend before dispatch (B06-AC4)
        reservation = self.budget_tracker.reserve(
            pool=pool,
            estimated_input_tokens=estimated_input_tokens,
            estimated_max_output_tokens=estimated_max_output_tokens,
            model_name=model_name,
        )

        try:
            # 2. Call remote provider
            response = provider.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                **kwargs,
            )

            # 3. Check continuation metadata (B06-AC2)
            if not response.continuation_metadata or "finish_reason" not in response.continuation_metadata:
                raise MissingContinuationMetadataError(
                    f"Provider response missing continuation metadata (finish_reason) for model {model_name}"
                )

            # 4. Reconcile real token usage
            settled = self.budget_tracker.reconcile(
                reservation_id=reservation.reservation_id,
                actual_input_tokens=response.usage.prompt_tokens,
                actual_output_tokens=response.usage.completion_tokens + response.usage.thinking_tokens,
            )
            response.usage.cost_cents = settled.actual_cost_cents
            return response

        except ProviderTimeoutError as e:
            # Retain uncertain reservation against budget ceiling (B06-AC4)
            self.budget_tracker.mark_uncertain(
                reservation_id=reservation.reservation_id,
                reason=f"ProviderTimeoutError: {str(e)}",
            )
            raise e
        except (ProviderCredentialMissingError, ProviderQuotaExceededError) as e:
            # Pre-network / remote rejection: release reservation
            self.budget_tracker.release(
                reservation_id=reservation.reservation_id,
                reason=f"Provider error: {type(e).__name__}",
            )
            raise e
        except Exception as e:
            # Treat other network failures as uncertain if dispatch was initiated
            self.budget_tracker.mark_uncertain(
                reservation_id=reservation.reservation_id,
                reason=f"Uncertain exception: {str(e)}",
            )
            raise e

    def generate_structured(
        self,
        prompt: str,
        response_schema: Type[T],
        role: str = "tutor",
        pool: str = "live_learning",
        system_prompt: Optional[str] = None,
        estimated_input_tokens: int = 800,
        estimated_max_output_tokens: int = 1500,
        max_repair_attempts: int = 1,
        task: Optional[ModelTask | str] = None,
        owner_id: Optional[str] = None,
        **kwargs,
    ) -> tuple[T, ProviderResponse]:
        """Run structured generation through the task router with safe fallbacks."""
        candidates = self._route_candidates(role, task, owner_id=owner_id)
        last_error: Optional[Exception] = None
        for model_key in candidates:
            try:
                return self._generate_structured_once(
                    prompt=prompt, response_schema=response_schema, role=role,
                    pool=pool, system_prompt=system_prompt,
                    estimated_input_tokens=estimated_input_tokens,
                    estimated_max_output_tokens=estimated_max_output_tokens,
                    max_repair_attempts=max_repair_attempts,
                    model_key=model_key, owner_id=owner_id, **kwargs,
                )
            except (ProviderCredentialMissingError, ProviderQuotaExceededError, BudgetExceededError) as exc:
                last_error = exc
                logger.warning("Structured model route '%s' unavailable for %s: %s", model_key, task or role, exc)
                continue
        if last_error:
            raise last_error
        raise ModelGatewayError(f"No usable structured model route configured for '{task or role}'")

    def _generate_structured_once(
        self,
        prompt: str,
        response_schema: Type[T],
        role: str = "tutor",
        pool: str = "live_learning",
        system_prompt: Optional[str] = None,
        estimated_input_tokens: int = 800,
        estimated_max_output_tokens: int = 1500,
        max_repair_attempts: int = 1,
        model_key: Optional[str] = None,
        owner_id: Optional[str] = None,
        **kwargs,
    ) -> tuple[T, ProviderResponse]:
        """
        Executes a structured generation request conforming strictly to response_schema.
        Performs bounded repair if response is malformed or invalid schema (B06-AC2).
        Returns tuple of (validated_model_instance, raw_provider_response).
        """
        provider = self.get_provider(role=role, model_key=model_key, owner_id=owner_id)
        model_name = provider.model_name

        # 1. Atomically reserve estimated max spend before dispatch (B06-AC4)
        reservation = self.budget_tracker.reserve(
            pool=pool,
            estimated_input_tokens=estimated_input_tokens,
            estimated_max_output_tokens=estimated_max_output_tokens,
            model_name=model_name,
        )

        total_input_tokens = 0
        total_output_tokens = 0

        try:
            # 2. Call remote provider
            response = provider.generate_structured(
                prompt=prompt,
                response_schema=response_schema,
                system_prompt=system_prompt,
                **kwargs,
            )

            total_input_tokens += response.usage.prompt_tokens
            total_output_tokens += response.usage.completion_tokens + response.usage.thinking_tokens

            # 3. Check continuation metadata (B06-AC2)
            if not response.continuation_metadata or "finish_reason" not in response.continuation_metadata:
                raise MissingContinuationMetadataError(
                    f"Provider response missing continuation metadata (finish_reason) for model {model_name}"
                )

            # 4. Attempt validation
            raw_content = response.content
            structured_data = response.structured_data or self._extract_json(raw_content)

            validated_instance: Optional[T] = None
            validation_error_str = ""

            if structured_data is not None:
                try:
                    validated_instance = response_schema.model_validate(structured_data)
                except ValidationError as ve:
                    validation_error_str = str(ve)
            else:
                validation_error_str = "Could not parse valid JSON from provider response."

            # 5. Bounded Repair if needed
            if validated_instance is None and max_repair_attempts > 0:
                logger.warning(
                    f"Structured validation failed: {validation_error_str}. Attempting bounded repair..."
                )
                repair_prompt = (
                    f"{prompt}\n\n"
                    f"Your previous response had schema validation errors:\n"
                    f"{validation_error_str}\n\n"
                    f"Previous output was:\n"
                    f"{raw_content}\n\n"
                    f"Please correct the error and output ONLY the valid JSON conforming strictly to the schema."
                )

                try:
                    repair_response = provider.generate_structured(
                        prompt=repair_prompt,
                        response_schema=response_schema,
                        system_prompt=system_prompt,
                        **kwargs,
                    )
                    total_input_tokens += repair_response.usage.prompt_tokens
                    total_output_tokens += (
                        repair_response.usage.completion_tokens + repair_response.usage.thinking_tokens
                    )

                    repair_data = repair_response.structured_data or self._extract_json(
                        repair_response.content
                    )
                    if repair_data:
                        validated_instance = response_schema.model_validate(repair_data)
                        response = repair_response
                except Exception as repair_exc:
                    logger.error(f"Bounded repair call failed: {repair_exc}")

            if validated_instance is None:
                raise SchemaValidationError(
                    f"Provider output failed schema validation for {response_schema.__name__}: {validation_error_str}",
                    raw_content=raw_content,
                )

            # 6. Reconcile total actual tokens used
            settled = self.budget_tracker.reconcile(
                reservation_id=reservation.reservation_id,
                actual_input_tokens=total_input_tokens,
                actual_output_tokens=total_output_tokens,
            )
            response.usage.total_tokens = total_input_tokens + total_output_tokens
            response.usage.cost_cents = settled.actual_cost_cents

            return validated_instance, response

        except ProviderTimeoutError as e:
            self.budget_tracker.mark_uncertain(
                reservation_id=reservation.reservation_id,
                reason=f"ProviderTimeoutError: {str(e)}",
            )
            raise e
        except (ProviderCredentialMissingError, ProviderQuotaExceededError) as e:
            self.budget_tracker.release(
                reservation_id=reservation.reservation_id,
                reason=f"Provider rejection: {type(e).__name__}",
            )
            raise e
        except SchemaValidationError:
            # Reconcile spend for tokens that were consumed even if schema failed
            if total_input_tokens > 0 or total_output_tokens > 0:
                self.budget_tracker.reconcile(
                    reservation_id=reservation.reservation_id,
                    actual_input_tokens=total_input_tokens,
                    actual_output_tokens=total_output_tokens,
                )
            else:
                self.budget_tracker.release(reservation_id=reservation.reservation_id)
            raise
        except MissingContinuationMetadataError:
            self.budget_tracker.release(reservation_id=reservation.reservation_id)
            raise
        except Exception as e:
            self.budget_tracker.mark_uncertain(
                reservation_id=reservation.reservation_id,
                reason=f"Uncertain exception: {str(e)}",
            )
            raise e
