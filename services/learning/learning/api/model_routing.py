"""Authenticated model-routing settings API."""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from learning.api.auth import AuthenticatedOwner, get_current_owner
from learning.config import load_models_config
from learning.models.routing import ModelTask
from learning.repositories.model_routing import get_model_routing, save_model_routing

router = APIRouter(prefix="/api/model-routing", tags=["Model Routing"])


class ModelRouteInput(BaseModel):
    primary: str
    fallbacks: list[str] = Field(default_factory=list)


class ModelRoutingInput(BaseModel):
    routes: Dict[str, ModelRouteInput]


def _catalog() -> list[dict[str, Any]]:
    config = load_models_config()
    return [
        {
            "key": key,
            "provider": model.provider,
            "model_name": model.model_name,
            "display_name": model.display_name or model.model_name,
            "enabled": model.enabled and model.provider != "external",
            "input_cost_per_m": model.pricing.input_cost_per_m,
            "output_cost_per_m": model.pricing.output_cost_per_m,
        }
        for key, model in config.models.items()
        if model.provider != "external"
    ]


@router.get("")
async def get_model_routing_endpoint(owner: AuthenticatedOwner = Depends(get_current_owner)):
    config = load_models_config()
    return {
        "models": _catalog(),
        "routes": get_model_routing(owner.owner_id, config),
        "protected_tasks": [ModelTask.REVIEWER.value],
    }


@router.put("")
async def put_model_routing_endpoint(
    body: ModelRoutingInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    try:
        config = load_models_config()
        routes = save_model_routing(
            owner.owner_id,
            {task: value.model_dump() for task, value in body.routes.items()},
            config,
        )
        return {"models": _catalog(), "routes": routes, "protected_tasks": [ModelTask.REVIEWER.value]}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
