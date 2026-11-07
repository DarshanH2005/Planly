"""Settings-only API for owner-scoped provider credentials."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, SecretStr

from learning.api.auth import AuthenticatedOwner, get_current_owner
from learning.repositories.provider_credentials import (
    SUPPORTED_PROVIDERS,
    SecretStorageUnavailable,
    delete_provider_api_key,
    get_provider_key_status,
    save_provider_api_key,
)

router = APIRouter(prefix="/api/provider-credentials", tags=["Provider Credentials"])


class ProviderCredentialInput(BaseModel):
    api_key: SecretStr = Field(min_length=1, max_length=512)


def _response(owner_id: str, statuses: dict[str, dict[str, Any]]):
    return {"providers": statuses, "supported_providers": sorted(SUPPORTED_PROVIDERS)}


@router.get("")
async def get_provider_credentials(owner: AuthenticatedOwner = Depends(get_current_owner)):
    return _response(owner.owner_id, get_provider_key_status(owner.owner_id))


@router.put("/{provider}")
async def put_provider_credential(
    provider: str,
    body: ProviderCredentialInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    try:
        statuses = save_provider_api_key(owner.owner_id, provider, body.api_key.get_secret_value())
        return _response(owner.owner_id, statuses)
    except (ValueError, SecretStorageUnavailable) as exc:
        code = status.HTTP_400_BAD_REQUEST if isinstance(exc, ValueError) else status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(status_code=code, detail=str(exc))


@router.delete("/{provider}")
async def delete_provider_credential(
    provider: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    try:
        statuses = delete_provider_api_key(owner.owner_id, provider)
        return _response(owner.owner_id, statuses)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
