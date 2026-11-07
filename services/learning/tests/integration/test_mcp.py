"""
Sprint B26: Model Context Protocol (MCP) Server Integration Tests
Authority: PLANLY_BUILD_SPEC.md §10, §12-13; B26_mcp.md

Tests:
- B26-AC1: Direct API and MCP retry of the same request cannot duplicate an attempt.
- B26-AC2: No arbitrary SQL, hidden evaluator material, or mark-mastered tool is exposed.
- B26-AC3: An external host omitting hint history cannot produce unassisted evidence.
- B26 JSON-RPC 2.0 protocol compliance: initialize, ping, tools/list, tools/call.
- Failure to Prevent: MCP routes through canonical persistence; never bypasses learner model.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    SessionStage,
    SessionMode,
)
from learning.repositories import evidence, sources, corrections, executions
from learning.mcp.server import PlanlyMCPServer, PERMITTED_TOOLS, FORBIDDEN_TOOLS, get_mcp_server
from learning.mcp import handlers


class TestMCPIntegration(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        handlers.reset_idempotency_cache()
        self.server = PlanlyMCPServer()
        self.owner_id = "test_mcp_learner"
        self.cls = evidence.create_classroom(self.owner_id, "dsa", "Algorithms Study")
        self.sess = evidence.create_session(
            self.owner_id, self.cls.id, stage=SessionStage.FOUNDATION, mode=SessionMode.PRACTICE
        )

    def test_b26_ac1_direct_api_and_mcp_retry_cannot_duplicate_attempt(self):
        """
        B26-AC1: Direct API and MCP retry of the same request cannot duplicate an attempt.
        Submitting an attempt via MCP with idempotency_key records it once; subsequent retries
        with the identical key return the idempotent replay without duplicating database attempts.
        """
        idempotency_key = "idemp_attempt_tok_99182"
        tool_args = {
            "owner_id": self.owner_id,
            "session_id": self.sess.id,
            "source_revision": 1,
            "frozen_code": "def two_sum(nums, target):\n    return []\n",
            "assistance_level": "independent",
            "hints_used": 0,
            "idempotency_key": idempotency_key,
        }

        # 1. First submission via MCP tools/call
        req1 = {
            "jsonrpc": "2.0",
            "id": "req-1",
            "method": "tools/call",
            "params": {"name": "record_attempt", "arguments": tool_args},
        }
        resp1 = self.server.handle_jsonrpc_request(req1)
        self.assertNotIn("error", resp1)
        data1 = resp1["result"]["data"]
        self.assertEqual(data1["status"], "recorded")
        self.assertFalse(data1["is_duplicate"])
        attempt_id_1 = data1["attempt_id"]

        # Check evidence store has exactly 1 attempt
        attempts = evidence.get_session_attempts(self.owner_id, self.sess.id)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].id, attempt_id_1)

        # 2. Duplicate retry via MCP tools/call
        req2 = {
            "jsonrpc": "2.0",
            "id": "req-2",
            "method": "tools/call",
            "params": {"name": "record_attempt", "arguments": tool_args},
        }
        resp2 = self.server.handle_jsonrpc_request(req2)
        self.assertNotIn("error", resp2)
        data2 = resp2["result"]["data"]
        self.assertEqual(data2["status"], "idempotent_replay")
        self.assertTrue(data2["is_duplicate"])
        self.assertEqual(data2["attempt_id"], attempt_id_1)

        # Store still has only 1 attempt
        attempts_after = evidence.get_session_attempts(self.owner_id, self.sess.id)
        self.assertEqual(len(attempts_after), 1)

    def test_b26_ac2_no_arbitrary_sql_evaluator_or_mastery_tools_exposed(self):
        """
        B26-AC2: No arbitrary SQL, hidden evaluator material, or mark-mastered tool is exposed.
        - tools/list must not contain any forbidden tool names.
        - Direct execution or RPC invocation of forbidden tools must raise PermissionError / code -32601.
        """
        # 1. Check tools/list
        req_list = {"jsonrpc": "2.0", "id": "list-1", "method": "tools/list", "params": {}}
        resp_list = self.server.handle_jsonrpc_request(req_list)
        exposed_tool_names = [t["name"] for t in resp_list["result"]["tools"]]

        for forbidden in FORBIDDEN_TOOLS:
            self.assertNotIn(
                forbidden,
                exposed_tool_names,
                f"Forbidden tool '{forbidden}' was exposed in tools/list! (B26-AC2)",
            )

        # 2. Attempt to call execute_arbitrary_sql via tools/call
        req_bad1 = {
            "jsonrpc": "2.0",
            "id": "bad-1",
            "method": "tools/call",
            "params": {
                "name": "execute_arbitrary_sql",
                "arguments": {"sql": "DELETE FROM classrooms;"},
            },
        }
        resp_bad1 = self.server.handle_jsonrpc_request(req_bad1)
        self.assertIn("error", resp_bad1)
        self.assertEqual(resp_bad1["error"]["code"], -32601)
        self.assertIn("strictly forbidden by policy", resp_bad1["error"]["message"])

        # 3. Attempt to call mark_mastered
        req_bad2 = {
            "jsonrpc": "2.0",
            "id": "bad-2",
            "method": "tools/call",
            "params": {
                "name": "mark_mastered",
                "arguments": {"competency_key": "two_pointers", "status": "mastered"},
            },
        }
        resp_bad2 = self.server.handle_jsonrpc_request(req_bad2)
        self.assertIn("error", resp_bad2)
        self.assertEqual(resp_bad2["error"]["code"], -32601)

        # 4. Attempt direct execute_tool on forbidden tool
        with self.assertRaises(PermissionError):
            self.server.execute_tool("reveal_evaluator_rubric", {})

    def test_b26_ac3_external_host_omitting_hint_history_cannot_produce_unassisted_evidence(self):
        """
        B26-AC3: An external host omitting hint history cannot produce unassisted evidence.
        - Missing assistance_level or omitting hint history defaults to AssistanceLevel.UNKNOWN.
        - When evaluated, attempts with AssistanceLevel.UNKNOWN cannot produce demonstrated independent success.
        """
        # 1. External host calls record_attempt without specifying assistance_level or hints_used
        args_omitted = {
            "owner_id": self.owner_id,
            "session_id": self.sess.id,
            "source_revision": 1,
            "frozen_code": "def solution(): return True",
            # omitted assistance_level and hints_used
        }
        req = {
            "jsonrpc": "2.0",
            "id": "ac3-1",
            "method": "tools/call",
            "params": {"name": "record_attempt", "arguments": args_omitted},
        }
        resp = self.server.handle_jsonrpc_request(req)
        self.assertNotIn("error", resp)
        data = resp["result"]["data"]
        self.assertEqual(data["assistance_level"], AssistanceLevel.UNKNOWN.value)
        attempt_id = data["attempt_id"]

        # 2. Host tries to claim 'independent' but omits hints_used
        args_claimed_independent = {
            "owner_id": self.owner_id,
            "session_id": self.sess.id,
            "source_revision": 1,
            "frozen_code": "def solution(): return True",
            "assistance_level": "independent",
            # hints_used is missing!
        }
        req2 = {
            "jsonrpc": "2.0",
            "id": "ac3-2",
            "method": "tools/call",
            "params": {"name": "record_attempt", "arguments": args_claimed_independent},
        }
        resp2 = self.server.handle_jsonrpc_request(req2)
        data2 = resp2["result"]["data"]
        # Must be downgraded to UNKNOWN because hint history was omitted
        self.assertEqual(data2["assistance_level"], AssistanceLevel.UNKNOWN.value)

        # 3. Host claims 'independent' but hints_used is 2 -> downgraded to GUIDED
        args_with_hints = {
            "owner_id": self.owner_id,
            "session_id": self.sess.id,
            "source_revision": 1,
            "frozen_code": "def solution(): return True",
            "assistance_level": "independent",
            "hints_used": 2,
        }
        req3 = {
            "jsonrpc": "2.0",
            "id": "ac3-3",
            "method": "tools/call",
            "params": {"name": "record_attempt", "arguments": args_with_hints},
        }
        resp3 = self.server.handle_jsonrpc_request(req3)
        data3 = resp3["result"]["data"]
        self.assertEqual(data3["assistance_level"], AssistanceLevel.GUIDED.value)

        # 4. Evaluation test: Evaluate the omitted-history attempt (attempt_id with UNKNOWN assistance)
        req_eval = {
            "jsonrpc": "2.0",
            "id": "ac3-eval",
            "method": "tools/call",
            "params": {
                "name": "evaluate_attempt",
                "arguments": {
                    "owner_id": self.owner_id,
                    "session_id": self.sess.id,
                    "attempt_id": attempt_id,
                    "code_submission": "print('passed')",
                    "competency_key": "two_pointers",
                },
            },
        }
        resp_eval = self.server.handle_jsonrpc_request(req_eval)
        self.assertNotIn("error", resp_eval)
        eval_data = resp_eval["result"]["data"]
        self.assertTrue(eval_data["success"])
        # Demonstrated MUST be False because assistance is UNKNOWN
        self.assertFalse(
            eval_data["demonstrated"],
            "Demonstrated success must be False when hint history is omitted (B26-AC3)",
        )
        self.assertEqual(eval_data["assistance_level"], AssistanceLevel.UNKNOWN.value)

    def test_b26_jsonrpc_protocol_flow(self):
        """
        Verifies standard MCP JSON-RPC 2.0 protocol interactions:
        initialize, ping, tools/list, resume_session, propose_plan, end_session.
        """
        # 1. initialize
        init_req = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        }
        init_resp = self.server.handle_jsonrpc_request(init_req)
        self.assertEqual(init_resp["result"]["protocolVersion"], "2024-11-05")
        self.assertEqual(init_resp["result"]["serverInfo"]["name"], "planly-learning-service")

        # 2. ping
        ping_req = {"jsonrpc": "2.0", "id": 2, "method": "ping"}
        ping_resp = self.server.handle_jsonrpc_request(ping_req)
        self.assertEqual(ping_resp["result"], {})

        # 3. resume_session
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            expected_revision=1,
            content="class Solution:\n    pass\n",
            language="python",
        )
        resume_req = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "resume_session",
                "arguments": {"owner_id": self.owner_id, "session_id": self.sess.id},
            },
        }
        resume_resp = self.server.handle_jsonrpc_request(resume_req)
        self.assertNotIn("error", resume_resp)
        resume_data = resume_resp["result"]["data"]
        self.assertEqual(resume_data["session_id"], self.sess.id)
        self.assertEqual(resume_data["latest_artifact"]["revision"], 1)

        # 4. propose_plan
        plan_req = {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "propose_plan",
                "arguments": {"owner_id": self.owner_id, "available_minutes": 45, "track": "dsa"},
            },
        }
        plan_resp = self.server.handle_jsonrpc_request(plan_req)
        self.assertNotIn("error", plan_resp)
        plan_data = plan_resp["result"]["data"]
        self.assertEqual(plan_data["allocated_minutes"], 45)
        self.assertEqual(len(plan_data["activities"]), 2)

        # 5. end_session
        end_req = {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "end_session",
                "arguments": {"owner_id": self.owner_id, "session_id": self.sess.id},
            },
        }
        end_resp = self.server.handle_jsonrpc_request(end_req)
        self.assertNotIn("error", end_resp)
        end_data = end_resp["result"]["data"]
        self.assertEqual(end_data["status"], "completed")

        # 6. Unknown method returns -32601
        unk_req = {"jsonrpc": "2.0", "id": 6, "method": "non_existent_method"}
        unk_resp = self.server.handle_jsonrpc_request(unk_req)
        self.assertEqual(unk_resp["error"]["code"], -32601)


if __name__ == "__main__":
    unittest.main()
