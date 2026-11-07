"""
Sprint B26: Planly Model Context Protocol (MCP) Server
Authority: PLANLY_BUILD_SPEC.md §10, §12-13; B26_mcp.md

Enforces:
- B26-AC1: Direct API and MCP retry of the same request cannot duplicate an attempt.
- B26-AC2: No arbitrary SQL, hidden evaluator material or mark-mastered tool is exposed.
- B26-AC3: An external host omitting hint history cannot produce unassisted evidence.
- Failure to Prevent: MCP is an interface, not a substitute for state persistence or learner model.
"""

from typing import Dict, Any, List, Optional
from learning.mcp import handlers


# Permitted Tool Definitions under B26-AC2
PERMITTED_TOOLS = [
    {
        "name": "resume_session",
        "description": "Resume an existing study session, retrieving pending artifact and prompt.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "session_id": {"type": "string"},
            },
            "required": ["owner_id", "session_id"],
        },
    },
    {
        "name": "search_memory",
        "description": "Search learner episodic memory and reference knowledge via hybrid retrieval.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 5},
            },
            "required": ["owner_id", "query"],
        },
    },
    {
        "name": "record_attempt",
        "description": "Record a learner code attempt with revision and assistance qualification.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "session_id": {"type": "string"},
                "source_revision": {"type": "integer"},
                "frozen_code": {"type": "string"},
                "assistance_level": {
                    "type": "string",
                    "enum": ["independent", "guided", "tutor_supplied", "unassessed", "unknown"],
                },
                "hints_used": {"type": "integer"},
                "idempotency_key": {"type": "string"},
            },
            "required": ["owner_id", "session_id"],
        },
    },
    {
        "name": "evaluate_attempt",
        "description": "Run sandboxed tests against an attempt and record execution evidence.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "session_id": {"type": "string"},
                "attempt_id": {"type": "string"},
                "code_submission": {"type": "string"},
                "competency_key": {"type": "string"},
            },
            "required": ["owner_id", "session_id", "attempt_id", "code_submission"],
        },
    },
    {
        "name": "propose_plan",
        "description": "Generate a capacity-aware study plan for the learner.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "available_minutes": {"type": "integer"},
                "track": {"type": "string"},
            },
            "required": ["owner_id"],
        },
    },
    {
        "name": "end_session",
        "description": "End the current active session and compute quiet debrief summary.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner_id": {"type": "string"},
                "session_id": {"type": "string"},
            },
            "required": ["owner_id", "session_id"],
        },
    },
]

FORBIDDEN_TOOLS = {
    "execute_arbitrary_sql",
    "run_sql",
    "mark_mastered",
    "override_readiness",
    "reveal_evaluator_rubric",
    "get_reference_solution",
}


class PlanlyMCPServer:
    """
    Model Context Protocol (MCP) JSON-RPC 2.0 Server.
    Exposes safe learning operations to external hosts.
    """

    def __init__(self, server_name: str = "planly-learning-service", version: str = "0.1.0"):
        self.server_name = server_name
        self.version = version
        self.tool_handlers = {
            "resume_session": handlers.handle_resume_session,
            "search_memory": handlers.handle_search_memory,
            "record_attempt": handlers.handle_record_attempt,
            "evaluate_attempt": handlers.handle_evaluate_attempt,
            "propose_plan": handlers.handle_propose_plan,
            "end_session": handlers.handle_end_session,
        }

    def list_tools(self) -> List[Dict[str, Any]]:
        return PERMITTED_TOOLS

    def execute_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        B26-AC2: Strictly rejects forbidden tools (SQL execution, direct mastery overrides,
        or evaluator rubrics).
        """
        if name in FORBIDDEN_TOOLS:
            raise PermissionError(
                f"Security violation: Tool '{name}' is strictly forbidden by policy (B26-AC2)."
            )

        if name not in self.tool_handlers:
            raise KeyError(f"Tool '{name}' is not recognized or exposed on this MCP server.")

        handler_fn = self.tool_handlers[name]
        return handler_fn(arguments)

    def handle_jsonrpc_request(self, req: Dict[str, Any]) -> Dict[str, Any]:
        """
        Processes a single JSON-RPC 2.0 request according to MCP specification.
        """
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": self.server_name,
                        "version": self.version,
                    },
                },
            }

        elif method == "notifications/initialized":
            return {"jsonrpc": "2.0", "result": {}}

        elif method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": {}}

        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"tools": self.list_tools()},
            }

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})
            try:
                content = self.execute_tool(tool_name, tool_args)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": str(content)}],
                        "isError": False,
                        "data": content,
                    },
                }
            except PermissionError as e:
                # B26-AC2 Security error
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": str(e),
                    },
                }
            except Exception as e:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32000,
                        "message": str(e),
                    },
                }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"Method '{method}' not found.",
                },
            }


_global_mcp_server: Optional[PlanlyMCPServer] = None


def get_mcp_server() -> PlanlyMCPServer:
    global _global_mcp_server
    if _global_mcp_server is None:
        _global_mcp_server = PlanlyMCPServer()
    return _global_mcp_server
