"""
Native Google Gemini Provider Adapter.
Uses Google Gemini REST API v1beta.
Preserves provider-specific continuation metadata (finish_reason, thoughts, safety).
Sprint: B06
"""

import json
import os
import time
from typing import Optional, Dict, Any, Type
import requests
from pydantic import BaseModel

from learning.models.providers.base import BaseModelProvider
from learning.models.types import (
    ProviderResponse,
    TokenUsage,
    ProviderCredentialMissingError,
    ProviderQuotaExceededError,
    ProviderTimeoutError,
    ModelGatewayError,
)


class GeminiProvider(BaseModelProvider):
    """
    Native Google Gemini provider adapter.
    Resolves API key from GEMINI_API_KEY environment variable.
    """

    def __init__(
        self,
        model_name: str = "gemini-3.8-flash",
        api_key: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(model_name=model_name, config=config)
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        # Keep the endpoint model explicit so production telemetry, budget
        # accounting, and the actual provider request always name the same
        # stable model.  A deployment may override it only deliberately.
        self.endpoint_model = self.config.get("endpoint_model") or self.model_name
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    def _ensure_credentials(self) -> str:
        if not self.api_key:
            raise ProviderCredentialMissingError(
                "GEMINI_API_KEY is not configured in the environment. "
                "Provider call cannot be executed (B06-AC1)."
            )
        return self.api_key

    def _build_url(self) -> str:
        key = self._ensure_credentials()
        return f"{self.base_url}/{self.endpoint_model}:generateContent?key={key}"

    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 2048,
        timeout_seconds: int = 30,
        **kwargs,
    ) -> ProviderResponse:
        url = self._build_url()
        headers = {"Content-Type": "application/json"}

        contents = [{"parts": [{"text": prompt}]}]
        body: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        start_time = time.perf_counter()
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=timeout_seconds)
        except requests.exceptions.Timeout as e:
            raise ProviderTimeoutError(f"Gemini call timed out after {timeout_seconds}s: {e}")
        except requests.exceptions.RequestException as e:
            raise ModelGatewayError(f"Gemini request network error: {e}")

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return self._process_response(resp, latency_ms)

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
        url = self._build_url()
        headers = {"Content-Type": "application/json"}

        # Format JSON schema instruction
        schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
        schema_prompt = (
            f"{prompt}\n\n"
            f"You MUST respond ONLY with a valid JSON object strictly conforming to this JSON schema:\n"
            f"{schema_json}\n"
            f"Do not include any markdown fences or explanatory text outside the JSON object."
        )

        contents = [{"parts": [{"text": schema_prompt}]}]
        body: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
                "responseMimeType": "application/json",
            },
        }
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        start_time = time.perf_counter()
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=timeout_seconds)
        except requests.exceptions.Timeout as e:
            raise ProviderTimeoutError(f"Gemini call timed out after {timeout_seconds}s: {e}")
        except requests.exceptions.RequestException as e:
            raise ModelGatewayError(f"Gemini request network error: {e}")

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return self._process_response(resp, latency_ms)

    def _process_response(self, resp: requests.Response, latency_ms: int) -> ProviderResponse:
        if resp.status_code == 429:
            raise ProviderQuotaExceededError(f"Gemini API quota exceeded (HTTP 429): {resp.text}")
        if resp.status_code in (401, 403):
            raise ProviderCredentialMissingError(f"Gemini authentication failed (HTTP {resp.status_code}): {resp.text}")
        if resp.status_code >= 500:
            raise ModelGatewayError(f"Gemini server error (HTTP {resp.status_code}): {resp.text}")
        if not resp.ok:
            raise ModelGatewayError(f"Gemini error (HTTP {resp.status_code}): {resp.text}")

        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise ModelGatewayError("Gemini returned empty candidates list")

        candidate = candidates[0]
        content_obj = candidate.get("content", {})
        parts = content_obj.get("parts", [])
        raw_text = "".join(p.get("text", "") for p in parts)

        # Usage metadata
        usage_meta = data.get("usageMetadata", {})
        prompt_tokens = usage_meta.get("promptTokenCount", 0)
        candidate_tokens = usage_meta.get("candidatesTokenCount", 0)
        total_tokens = usage_meta.get("totalTokenCount", prompt_tokens + candidate_tokens)

        # Check for thinking tokens in details
        thinking_tokens = 0
        for detail in usage_meta.get("candidatesTokensDetails", []):
            if detail.get("modality") == "THINKING":
                thinking_tokens += detail.get("tokenCount", 0)

        usage = TokenUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=candidate_tokens,
            thinking_tokens=thinking_tokens,
            total_tokens=total_tokens,
            cost_cents=0,  # Computed by BudgetTracker
        )

        # Continuation metadata
        continuation_metadata: Dict[str, Any] = {
            "finish_reason": candidate.get("finishReason", "STOP"),
            "safety_ratings": candidate.get("safetyRatings", []),
            "model_version": data.get("modelVersion", self.model_name),
            "role": content_obj.get("role", "model"),
        }
        if thinking_tokens > 0:
            continuation_metadata["thinking_tokens"] = thinking_tokens

        # Attempt structured parse if JSON
        structured_data = None
        cleaned_text = raw_text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text[7:]
        if cleaned_text.startswith("```"):
            cleaned_text = cleaned_text[3:]
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3]
        cleaned_text = cleaned_text.strip()

        try:
            structured_data = json.loads(cleaned_text)
        except json.JSONDecodeError:
            pass

        return ProviderResponse(
            content=raw_text,
            structured_data=structured_data,
            model_name=self.model_name,
            usage=usage,
            continuation_metadata=continuation_metadata,
            latency_ms=latency_ms,
            provider_receipt=resp.headers.get("x-goog-request-id", f"gemini_{int(time.time())}"),
        )
