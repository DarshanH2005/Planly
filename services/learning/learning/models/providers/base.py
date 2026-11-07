"""
Base Model Provider Interface.
Sprint: B06
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Type
from pydantic import BaseModel
from learning.models.types import ProviderResponse


class BaseModelProvider(ABC):
    """Abstract interface for native model provider adapters."""

    def __init__(self, model_name: str, config: Optional[Dict[str, Any]] = None):
        self.model_name = model_name
        self.config = config or {}

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 2048,
        timeout_seconds: int = 30,
        **kwargs,
    ) -> ProviderResponse:
        """Executes a standard text generation request."""
        pass

    @abstractmethod
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
        """Executes a structured generation request conforming to response_schema."""
        pass
