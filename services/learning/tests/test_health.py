import asyncio
import json
import sys
from pathlib import Path

# Ensure services/learning is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from learning.api.main import app, get_health


def test_health_handler_direct():
    """Verify route handler returns valid HealthResponse."""
    res = asyncio.run(get_health())
    assert res.status == "ok"
    assert res.service == "learning"
    assert res.version == "0.1.0"
    print("Direct handler test: PASSED")


def test_health_asgi_invocation():
    """Verify ASGI request dispatch to /api/health with status 200 and JSON body."""
    response_body = []
    response_headers = []
    status_code = None

    async def run_asgi():
        nonlocal status_code

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_headers.extend(message.get("headers", []))
            elif message["type"] == "http.response.body":
                response_body.append(message.get("body", b""))

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/health",
            "raw_path": b"/api/health",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
        }

        await app(scope, receive, send)

    asyncio.run(run_asgi())

    assert status_code == 200, f"Expected 200, got {status_code}"
    raw_json = b"".join(response_body).decode("utf-8")
    data = json.loads(raw_json)
    assert data == {"status": "ok", "service": "learning", "version": "0.1.0"}
    print(f"ASGI /api/health test: PASSED -> Status {status_code}, Body: {data}")


if __name__ == "__main__":
    test_health_handler_direct()
    test_health_asgi_invocation()
    print("All B01-AC2 Health tests PASSED successfully.")
