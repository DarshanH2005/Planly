import os
import json
import base64
import time
import hmac
import hashlib
from typing import Optional
from uuid import UUID
from fastapi import Header, HTTPException, status
from pydantic import BaseModel
from learning.repositories.identity import is_owner_allowed

"""
Sprint B02: API Authentication Boundary & Private-Owner Guard

Enforces:
1. Bearer token extraction and validation.
2. Private-owner authorization check via allowed_owners.
3. Strict fail-closed on missing/expired credentials (401) or non-allowed owner (403).
4. Strict fail-closed on unconfigured pilot path (503).
"""


class AuthenticatedOwner(BaseModel):
    owner_id: str
    email: Optional[str] = None
    role: str = "authenticated"


def _decode_jwt_payload_unverified(token: str) -> dict:
    """Decode a development-only token payload after its structure is checked."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT token format")
    payload_b64 = parts[1]
    # Add padding if needed
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    decoded_bytes = base64.urlsafe_b64decode(padded)
    return json.loads(decoded_bytes.decode("utf-8"))


def _verify_hs256_jwt(token: str, secret: str) -> dict:
    """Verify Supabase's symmetric JWT before trusting any owner claim."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT token format")
    header_b64, payload_b64, signature_b64 = parts
    header_padding = header_b64 + "=" * (-len(header_b64) % 4)
    header = json.loads(base64.urlsafe_b64decode(header_padding).decode("utf-8"))
    if header.get("alg") != "HS256":
        raise ValueError("Unsupported JWT algorithm")

    signed = f"{header_b64}.{payload_b64}".encode("ascii")
    expected = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(expected, signature_b64):
        raise ValueError("Invalid JWT signature")
    return _decode_jwt_payload_unverified(token)


async def get_current_owner(
    authorization: Optional[str] = Header(None, alias="Authorization")
) -> AuthenticatedOwner:
    """
    FastAPI dependency: authenticates owner from Bearer token and verifies
    presence in the private workbench allowlist.
    """
    # Compose uses APP_ENV=production.  Keep all supported deployment flags in
    # one decision so production can never silently take the unsigned fixture
    # token path.
    is_production = any(
        os.environ.get(name, "").strip().lower() in {"production", "pilot"}
        for name in ("PLANLY_ENV", "ENV", "APP_ENV", "NODE_ENV")
    )
    jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")

    # If running in pilot/production and critical auth config is missing, fail clearly with 503
    if is_production and not jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication configuration is unconfigured on the pilot path.",
        )

    # 1. Require credentials
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization scheme. Expected 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = token.strip()

    # 2. Verify before reading claims.  The unsigned fixture-token path is
    # explicitly development-only and is unavailable for every production
    # flag, including APP_ENV used by Compose.
    try:
        if is_production:
            payload = _verify_hs256_jwt(token, jwt_secret)  # type: ignore[arg-type]
        elif jwt_secret:
            payload = _verify_hs256_jwt(token, jwt_secret)
        else:
            payload = _decode_jwt_payload_unverified(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or malformed authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check expiration
    exp = payload.get("exp")
    if is_production and not isinstance(exp, (int, float)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing expiration.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if isinstance(exp, (int, float)) and time.time() > exp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    nbf = payload.get("nbf")
    if isinstance(nbf, (int, float)) and time.time() < nbf:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is not valid yet.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expected_issuer = os.environ.get("SUPABASE_JWT_ISSUER")
    if expected_issuer and payload.get("iss") != expected_issuer:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token issuer is invalid.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expected_audience = os.environ.get("SUPABASE_JWT_AUDIENCE")
    if expected_audience:
        audience = payload.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if expected_audience not in audiences:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication token audience is invalid.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    owner_id = payload.get("sub")
    email = payload.get("email")

    if not owner_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing required subject (sub) claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate UUID formatting
    try:
        UUID(str(owner_id))
    except ValueError:
        # Non-UUID subjects are rejected unless in development with dev-owner-001
        if not (owner_id == "dev-owner-001" and not is_production):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Subject claim must be a valid UUID.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # 3. Check private-owner authorization (B02-AC2 / B02-AC3)
    if not is_owner_allowed(str(owner_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is authenticated but not an authorized owner of this private workbench.",
        )

    return AuthenticatedOwner(
        owner_id=str(owner_id),
        email=email,
        role=payload.get("role", "authenticated"),
    )
