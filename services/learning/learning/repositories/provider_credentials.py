"""Owner-scoped encrypted provider credentials."""

import os
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from learning.repositories.db import DB_PATH, get_db

SUPPORTED_PROVIDERS = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}


class SecretStorageUnavailable(RuntimeError):
    """Raised when the API cannot safely encrypt or decrypt a stored secret."""


def _is_production() -> bool:
    return any(
        os.environ.get(name, "").strip().lower() in {"production", "pilot"}
        for name in ("PLANLY_ENV", "ENV", "APP_ENV", "NODE_ENV")
    )


def _local_key_path() -> Path:
    return Path(DB_PATH).with_name(".provider-api-key-encryption.key")


def _encryption_key() -> bytes:
    configured = os.environ.get("PLANLY_API_KEY_ENCRYPTION_KEY", "").strip()
    if configured:
        return configured.encode("ascii")

    if _is_production():
        raise SecretStorageUnavailable(
            "PLANLY_API_KEY_ENCRYPTION_KEY must be configured before provider keys can be stored."
        )

    # Development convenience: keep the master key outside the repository so
    # local Settings works without asking the user to manage another secret.
    path = _local_key_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_bytes().strip()

    key = Fernet.generate_key()
    with path.open("xb") as handle:
        handle.write(key)
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return key


def _cipher() -> Fernet:
    try:
        return Fernet(_encryption_key())
    except (ValueError, UnicodeEncodeError) as exc:
        raise SecretStorageUnavailable(
            "PLANLY_API_KEY_ENCRYPTION_KEY is invalid; use a Fernet-generated key."
        ) from exc


def _validate_provider(provider: str) -> None:
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Unsupported provider: {provider}")


def get_provider_key_status(owner_id: str) -> dict[str, dict[str, Any]]:
    """Return metadata only; plaintext credentials never leave this module."""
    statuses = {
        provider: {"configured": False, "updated_at": None}
        for provider in SUPPORTED_PROVIDERS
    }
    rows = get_db().execute(
        "SELECT provider, updated_at FROM provider_api_keys WHERE owner_id = ?",
        (owner_id,),
    ).fetchall()
    for row in rows:
        if row["provider"] in statuses:
            statuses[row["provider"]] = {
                "configured": True,
                "updated_at": row["updated_at"],
            }
    return statuses


def get_provider_api_key(owner_id: str, provider: str) -> str | None:
    """Decrypt one owner's credential for a server-side provider call."""
    _validate_provider(provider)
    row = get_db().execute(
        "SELECT ciphertext FROM provider_api_keys WHERE owner_id = ? AND provider = ?",
        (owner_id, provider),
    ).fetchone()
    if not row:
        return None
    try:
        return _cipher().decrypt(row["ciphertext"].encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError, ValueError) as exc:
        raise SecretStorageUnavailable(
            f"Stored {provider} credential cannot be decrypted; rotate it in Settings."
        ) from exc


def save_provider_api_key(owner_id: str, provider: str, api_key: str) -> dict[str, dict[str, Any]]:
    _validate_provider(provider)
    value = api_key.strip()
    if not value:
        raise ValueError("API key cannot be empty")
    if len(value) > 512:
        raise ValueError("API key is too long")

    encrypted = _cipher().encrypt(value.encode("utf-8")).decode("ascii")
    now = datetime.now(timezone.utc).isoformat()
    with get_db():
        get_db().execute(
            "INSERT OR REPLACE INTO provider_api_keys (owner_id, provider, ciphertext, updated_at) VALUES (?, ?, ?, ?)",
            (owner_id, provider, encrypted, now),
        )
    return get_provider_key_status(owner_id)


def delete_provider_api_key(owner_id: str, provider: str) -> dict[str, dict[str, Any]]:
    _validate_provider(provider)
    with get_db():
        get_db().execute(
            "DELETE FROM provider_api_keys WHERE owner_id = ? AND provider = ?",
            (owner_id, provider),
        )
    return get_provider_key_status(owner_id)
