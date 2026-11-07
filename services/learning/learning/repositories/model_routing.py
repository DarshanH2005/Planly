"""Owner-scoped model-routing preferences."""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from learning.config import ModelsConfig
from learning.models.routing import DEFAULT_ROUTES, ModelTask
from learning.repositories.db import get_db


def _default_routes(models_config: ModelsConfig) -> Dict[str, Dict[str, Any]]:
    routes: Dict[str, Dict[str, Any]] = {}
    for task, default in DEFAULT_ROUTES.items():
        configured = models_config.routing.get(task.value)
        primary, *fallbacks = (
            [configured.primary, *configured.fallbacks]
            if configured
            else list(default)
        )
        routes[task.value] = {"primary": primary, "fallbacks": fallbacks}
    return routes


def get_model_routing(owner_id: str, models_config: ModelsConfig) -> Dict[str, Dict[str, Any]]:
    """Return effective routes: persisted owner overrides over config defaults."""
    routes = _default_routes(models_config)
    db = get_db()
    rows = db.execute(
        "SELECT task, primary_model, fallbacks_json FROM model_routing_preferences WHERE owner_id = ?",
        (owner_id,),
    ).fetchall()
    for row in rows:
        if row["task"] not in routes:
            continue
        routes[row["task"]] = {
            "primary": row["primary_model"],
            "fallbacks": json.loads(row["fallbacks_json"] or "[]"),
        }
    return routes


def save_model_routing(
    owner_id: str,
    routes: Dict[str, Dict[str, Any]],
    models_config: ModelsConfig,
) -> Dict[str, Dict[str, Any]]:
    """Validate and persist editable non-reviewer routes for one owner."""
    effective = get_model_routing(owner_id, models_config)
    available = {
        key for key, model in models_config.models.items()
        if model.enabled and model.provider != "external"
    }
    now = datetime.now(timezone.utc).isoformat()

    with get_db():
        for task, proposed in routes.items():
            if task == ModelTask.REVIEWER.value:
                if proposed != effective[task]:
                    raise ValueError("The reviewer route is managed by the server policy and cannot be edited here")
                # The UI submits the complete settings object. An unchanged
                # protected row is accepted but never persisted as a user
                # preference.
                continue
            if task not in effective or not isinstance(proposed, dict):
                raise ValueError(f"Unknown model-routing task: {task}")
            primary = proposed.get("primary")
            fallbacks = proposed.get("fallbacks", [])
            if primary not in available:
                raise ValueError(f"Model '{primary}' is not available for routing")
            if not isinstance(fallbacks, list) or any(item not in available for item in fallbacks):
                raise ValueError(f"Invalid fallback model for task '{task}'")
            if primary in fallbacks or len(set(fallbacks)) != len(fallbacks):
                raise ValueError(f"Route '{task}' contains duplicate primary/fallback models")
            effective[task] = {"primary": primary, "fallbacks": fallbacks}
            get_db().execute(
                "INSERT OR REPLACE INTO model_routing_preferences (owner_id, task, primary_model, fallbacks_json, updated_at) VALUES (?, ?, ?, ?, ?)",
                (owner_id, task, primary, json.dumps(fallbacks), now),
            )
    return effective
