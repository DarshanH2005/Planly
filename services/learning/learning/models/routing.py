"""Task-aware model selection for the Planly model gateway.

Workflows choose a logical task, never a provider.  This keeps model choice
centralized, auditable, and easy to change as quality, cost, or availability
changes.  Fallbacks are ordered and are only used by the gateway for failures
that are safe to retry before a provider call has been accepted.
"""

from enum import Enum
from typing import List, Optional

from learning.config import ModelsConfig


class ModelTask(str, Enum):
    TUTOR_REPLY = "tutor_reply"
    LESSON_ASSESSMENT = "lesson_assessment"
    PLANNER = "planner"
    SUMMARY = "summary"
    RETRIEVAL_RERANK = "retrieval_rerank"
    SCHEMA_REPAIR = "schema_repair"
    REVIEWER = "reviewer"


DEFAULT_ROUTES = {
    # Gemini remains the quality-first classroom model. Luna is the safe
    # lower-cost fallback when Gemini credentials/quota are unavailable.
    ModelTask.TUTOR_REPLY: ("tutor", "openai_luna"),
    ModelTask.LESSON_ASSESSMENT: ("tutor", "openai_luna"),
    # Cheap structured work defaults to Luna; Gemini remains a quality fallback.
    ModelTask.PLANNER: ("openai_luna", "tutor"),
    ModelTask.SUMMARY: ("openai_luna", "tutor"),
    ModelTask.RETRIEVAL_RERANK: ("openai_luna", "tutor"),
    ModelTask.SCHEMA_REPAIR: ("openai_luna", "tutor"),
    ModelTask.REVIEWER: ("reviewer", "tutor"),
}


class ModelRouter:
    """Resolves a logical task to an ordered list of configured model keys."""

    def __init__(self, models_config: ModelsConfig):
        self.models_config = models_config

    def candidates(
        self,
        task: ModelTask | str,
        preferred: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> List[str]:
        task_key = task.value if isinstance(task, ModelTask) else str(task)
        configured = self.models_config.routing.get(task_key)
        if owner_id:
            # Keep persistence out of module import time to avoid a model /
            # repository import cycle.
            from learning.repositories.model_routing import get_model_routing

            owner_route = get_model_routing(owner_id, self.models_config).get(task_key)
            ordered = [owner_route["primary"], *owner_route["fallbacks"]] if owner_route else []
        elif configured:
            ordered = [configured.primary, *configured.fallbacks]
        else:
            ordered = []

        if not ordered:
            try:
                default = DEFAULT_ROUTES.get(ModelTask(task_key), ("tutor",))
            except ValueError:
                default = ("tutor",)
            ordered = list(default)

        if preferred:
            ordered = [preferred, *ordered]

        # Keep order while removing duplicates and unknown/disabled/external
        # models. External IDE models are intentionally not API-routed.
        result: List[str] = []
        for key in ordered:
            model = self.models_config.models.get(key)
            if not model or not model.enabled or model.provider == "external":
                continue
            if key not in result:
                result.append(key)
        return result
