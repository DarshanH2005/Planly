"""Tests for Settings-only encrypted provider credentials."""

from learning.config import load_models_config
from learning.models.gateway import ModelGateway
from learning.models.routing import ModelTask
from learning.repositories.db import get_db
from learning.repositories.provider_credentials import (
    delete_provider_api_key,
    get_provider_api_key,
    get_provider_key_status,
    save_provider_api_key,
)


def test_provider_credentials_are_owner_scoped_and_used_by_gateway():
    owner_id = "provider-credential-test-owner"
    other_owner_id = "provider-credential-test-other"
    value = "test-provider-key-not-a-real-secret"
    try:
        save_provider_api_key(owner_id, "openai", value)

        assert get_provider_api_key(owner_id, "openai") == value
        assert get_provider_api_key(other_owner_id, "openai") is None
        status = get_provider_key_status(owner_id)
        assert status["openai"]["configured"] is True
        assert status["gemini"]["configured"] is False

        stored = get_db().execute(
            "SELECT ciphertext FROM provider_api_keys WHERE owner_id = ? AND provider = ?",
            (owner_id, "openai"),
        ).fetchone()
        assert stored is not None
        assert value not in stored["ciphertext"]

        gateway = ModelGateway(models_config=load_models_config())
        provider = gateway.get_provider(
            role="tutor",
            task=ModelTask.TUTOR_REPLY,
            model_key="openai_luna",
            owner_id=owner_id,
        )
        assert getattr(provider, "api_key", None) == value
    finally:
        delete_provider_api_key(owner_id, "openai")
