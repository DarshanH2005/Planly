"""OpenAI Responses API provider adapter for routed Planly tasks."""

import json
import os
import time
from typing import Any, Dict, Optional, Type

import requests
from pydantic import BaseModel

from learning.models.providers.base import BaseModelProvider
from learning.models.types import (
    ModelGatewayError,
    ProviderCredentialMissingError,
    ProviderQuotaExceededError,
    ProviderTimeoutError,
    ProviderResponse,
    TokenUsage,
)


class OpenAIProvider(BaseModelProvider):
    """Native OpenAI Responses API adapter using the server-side API key."""

    def __init__(
        self,
        model_name: str = "gpt-5.6-luna",
        api_key: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(model_name=model_name, config=config)
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = self.config.get("base_url", "https://api.openai.com/v1/responses")

    def _ensure_credentials(self) -> str:
        if not self.api_key:
            raise ProviderCredentialMissingError(
                "OPENAI_API_KEY is not configured. OpenAI routing cannot execute."
            )
        return self.api_key

    def _request(
        self,
        prompt: str,
        system_prompt: Optional[str],
        max_output_tokens: int,
        timeout_seconds: int,
        schema: Optional[Type[BaseModel]] = None,
        reasoning_effort: Optional[str] = None,
    ) -> ProviderResponse:
        key = self._ensure_credentials()
        body: Dict[str, Any] = {
            "model": self.model_name,
            "input": prompt,
            "max_output_tokens": max_output_tokens,
        }
        if system_prompt:
            body["instructions"] = system_prompt
        if reasoning_effort:
            body["reasoning"] = {"effort": reasoning_effort}
        if schema:
            body["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": schema.__name__.lower(),
                    "strict": True,
                    "schema": schema.model_json_schema(),
                }
            }

        start = time.perf_counter()
        try:
            response = requests.post(
                self.base_url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=body,
                timeout=timeout_seconds,
            )
        except requests.exceptions.Timeout as exc:
            raise ProviderTimeoutError(f"OpenAI call timed out after {timeout_seconds}s: {exc}")
        except requests.exceptions.RequestException as exc:
            raise ModelGatewayError(f"OpenAI request network error: {exc}")

        latency_ms = int((time.perf_counter() - start) * 1000)
        if response.status_code == 429:
            raise ProviderQuotaExceededError(f"OpenAI API quota exceeded: {response.text}")
        if response.status_code in (401, 403):
            raise ProviderCredentialMissingError(f"OpenAI authentication failed: {response.text}")
        if response.status_code >= 500:
            raise ModelGatewayError(f"OpenAI server error ({response.status_code}): {response.text}")
        if not response.ok:
            raise ModelGatewayError(f"OpenAI error ({response.status_code}): {response.text}")

        data = response.json()
        content = data.get("output_text") or self._extract_output_text(data)
        usage_data = data.get("usage") or {}
        output_details = usage_data.get("output_tokens_details") or {}
        usage = TokenUsage(
            prompt_tokens=int(usage_data.get("input_tokens", 0)),
            completion_tokens=int(usage_data.get("output_tokens", 0)),
            thinking_tokens=int(output_details.get("reasoning_tokens", 0)),
            total_tokens=int(usage_data.get("total_tokens", 0)),
        )
        structured = None
        if content:
            try:
                structured = json.loads(content)
            except json.JSONDecodeError:
                pass
        return ProviderResponse(
            content=content,
            structured_data=structured,
            model_name=self.model_name,
            usage=usage,
            continuation_metadata={
                "finish_reason": data.get("status", "completed"),
                "response_id": data.get("id", ""),
            },
            latency_ms=latency_ms,
            provider_receipt=data.get("id", f"openai_{int(time.time())}"),
        )

    @staticmethod
    def _extract_output_text(data: Dict[str, Any]) -> str:
        parts = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    parts.append(content.get("text", ""))
        return "".join(parts)

    def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.2,
                 max_output_tokens: int = 2048, timeout_seconds: int = 30, **kwargs) -> ProviderResponse:
        return self._request(
            prompt, system_prompt, max_output_tokens, timeout_seconds,
            reasoning_effort=kwargs.get("reasoning_effort") or self.config.get("reasoning_effort"),
        )

    def generate_structured(self, prompt: str, response_schema: Type[BaseModel],
                            system_prompt: Optional[str] = None, temperature: float = 0.1,
                            max_output_tokens: int = 2048, timeout_seconds: int = 30, **kwargs) -> ProviderResponse:
        return self._request(
            prompt, system_prompt, max_output_tokens, timeout_seconds,
            schema=response_schema,
            reasoning_effort=kwargs.get("reasoning_effort") or self.config.get("reasoning_effort"),
        )
