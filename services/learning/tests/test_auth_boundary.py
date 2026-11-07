import os
import sys
import json
import base64
import time
import asyncio
from pathlib import Path

# Ensure services/learning is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from learning.api.main import app
from learning.repositories.identity import (
    bootstrap_allowed_owner,
    reset_identity_store,
    get_transaction_local_scope_sql,
)


def _make_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_signature_bytes_12345678").decode().rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


async def _dispatch_request(method: str, path: str, headers: list = None):
    response_body = []
    status_code = None

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            response_body.append(message.get("body", b""))

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": headers or [(b"host", b"testserver")],
    }

    await app(scope, receive, send)
    raw = b"".join(response_body).decode("utf-8")
    body = json.loads(raw) if raw else {}
    return status_code, body


def test_absent_credentials_rejected():
    """B02-AC2: Requests with missing Authorization header must receive 401."""
    status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me"))
    assert status == 401, f"Expected 401, got {status}"
    assert "detail" in body
    print("Test Absent Credentials (401): PASSED")


def test_invalid_token_format_rejected():
    """B02-AC2: Malformed authorization header must receive 401."""
    headers = [
        (b"host", b"testserver"),
        (b"authorization", b"Bearer not-a-jwt"),
    ]
    status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me", headers))
    assert status == 401, f"Expected 401, got {status}"
    print("Test Malformed Token (401): PASSED")


def test_expired_token_rejected():
    """B02-AC2: Expired JWT token must receive 401."""
    expired_token = _make_jwt({
        "sub": "00000000-0000-0000-0000-000000000001",
        "email": "owner@planly.internal",
        "exp": time.time() - 3600,  # 1 hour ago
    })
    headers = [
        (b"host", b"testserver"),
        (b"authorization", f"Bearer {expired_token}".encode("utf-8")),
    ]
    status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me", headers))
    assert status == 401, f"Expected 401, got {status}"
    assert "expired" in body.get("detail", "").lower()
    print("Test Expired Token (401): PASSED")


def test_unauthorized_owner_rejected():
    """B02-AC2: Valid JWT for user NOT in allowed_owners must receive 403."""
    intruder_token = _make_jwt({
        "sub": "11111111-1111-1111-1111-111111111111",
        "email": "intruder@example.com",
        "exp": time.time() + 3600,
    })
    headers = [
        (b"host", b"testserver"),
        (b"authorization", f"Bearer {intruder_token}".encode("utf-8")),
    ]
    status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me", headers))
    assert status == 403, f"Expected 403, got {status}"
    assert "authorized owner" in body.get("detail", "").lower()
    print("Test Non-Allowed Owner (403): PASSED")


def test_allowed_owner_accepted():
    """B02-AC3: Valid JWT for allowed owner succeeds with 200 and owner profile."""
    owner_id = "00000000-0000-0000-0000-000000000001"
    valid_token = _make_jwt({
        "sub": owner_id,
        "email": "darshan@planly.internal",
        "role": "authenticated",
        "exp": time.time() + 3600,
    })
    headers = [
        (b"host", b"testserver"),
        (b"authorization", f"Bearer {valid_token}".encode("utf-8")),
    ]
    status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me", headers))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["owner_id"] == owner_id
    assert body["authorized"] is True
    print(f"Test Allowed Owner (200): PASSED -> {body}")


def test_pilot_unconfigured_fails_closed():
    """B02-AC2: Missing configuration on pilot path fails with 503 Service Unavailable."""
    orig_env = os.environ.get("PLANLY_ENV")
    orig_secret = os.environ.get("SUPABASE_JWT_SECRET")

    try:
        os.environ["PLANLY_ENV"] = "pilot"
        if "SUPABASE_JWT_SECRET" in os.environ:
            del os.environ["SUPABASE_JWT_SECRET"]

        valid_token = _make_jwt({
            "sub": "00000000-0000-0000-0000-000000000001",
            "exp": time.time() + 3600,
        })
        headers = [
            (b"host", b"testserver"),
            (b"authorization", f"Bearer {valid_token}".encode("utf-8")),
        ]
        status, body = asyncio.run(_dispatch_request("GET", "/api/auth/me", headers))
        assert status == 503, f"Expected 503 on unconfigured pilot path, got {status}"
        print("Test Unconfigured Pilot Path (503): PASSED")
    finally:
        if orig_env is not None:
            os.environ["PLANLY_ENV"] = orig_env
        else:
            os.environ.pop("PLANLY_ENV", None)

        if orig_secret is not None:
            os.environ["SUPABASE_JWT_SECRET"] = orig_secret


def test_transaction_local_scope():
    """B02 Item 4: Verify transaction-local identity scope SQL generation."""
    sql = get_transaction_local_scope_sql("00000000-0000-0000-0000-000000000001")
    assert sql == "SET LOCAL planly.current_owner_id = '00000000-0000-0000-0000-000000000001';"
    print("Test Transaction-Local Scope SQL: PASSED")


if __name__ == "__main__":
    test_absent_credentials_rejected()
    test_invalid_token_format_rejected()
    test_expired_token_rejected()
    test_unauthorized_owner_rejected()
    test_allowed_owner_accepted()
    test_pilot_unconfigured_fails_closed()
    test_transaction_local_scope()
    print("\nAll B02 Authentication & Boundary Tests PASSED successfully.")
