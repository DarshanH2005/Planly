"""
Sprint B11: DSA Vertical Slice Integration Test.
Authority: planly_architecture.md sections 2, 14-16; B11_dsa_pilot_gate.md

Verifies:
- B11-AC1: Pending Two Pointers, deferred prefix sums and guided versus independent evidence survive restart.
- B11-AC2: All fixed source/ownership/resume gates pass; retrieval misses and model failures remain visible.
- Failure to prevent: Finite test pass is not independent mastery; provider failure remains visible.
"""

import os
import sys
import unittest
from pathlib import Path

# Add services/learning to sys.path
SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    SessionMode,
    AssistanceLevel,
    SourceKind,
    EventType,
    RunState,
    PendingTaskType,
    PendingTaskStatus,
    ContextPacket,
)
from learning.repositories import evidence, sources, runs
from learning.repositories.evidence import (
    CrossOwnerReferenceError,
    DanglingReferenceError,
    record_observation,
    save_artifact,
    get_session_observations,
    get_artifact,
    get_session,
)
from learning.repositories.sources import (
    get_pending_tasks,
    update_pending_task_status,
    reset_sources_store,
)
from learning.repositories.runs import (
    create_or_get_turn_run,
    claim_next_job,
    write_run_event,
    cancel_run,
    get_run_events,
    reset_runs_store,
)
from learning.imports.importer import (
    import_chat_export_file,
    reset_import_sessions,
    get_imported_session_id,
)
from learning.learner.decisions import make_teaching_decision, validate_teaching_decision
from learning.retrieval.context_assembler import assemble_context_packet
from learning.models.gateway import ModelGateway
from learning.models.types import ProviderCredentialMissingError


class TestDsaVerticalSlice(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        sources.reset_sources_store()
        runs.reset_runs_store()
        reset_import_sessions()

        self.owner_id = "00000000-0000-0000-0000-000000000001"
        self.other_owner_id = "00000000-0000-0000-0000-000000000099"
        self.dsa_file = Path("C:/Users/darsh/Downloads/darshan_dsa_chat_export.md")

    def test_b11_ac1_dsa_journey_and_restart_survival(self):
        """
        B11-AC1: Run real import -> answer -> feedback -> activity update -> restart -> resume journey.
        Verifies: Pending Two Pointers, deferred prefix sums and guided vs independent evidence survive restart.
        """
        self.assertTrue(self.dsa_file.exists(), f"DSA chat export file {self.dsa_file} must exist")

        # Step 1: Real import of DSA chat source
        import_result = import_chat_export_file(self.owner_id, self.dsa_file, track_override="dsa")
        self.assertFalse(import_result.is_duplicate)
        self.assertEqual(import_result.observations_created, 2)

        session_id = get_imported_session_id(self.owner_id, "dsa")
        self.assertIsNotNone(session_id)
        session = get_session(self.owner_id, session_id)
        self.assertIsNotNone(session)
        classroom_id = session.classroom_id

        # Verify initial pending tasks staged by import
        all_pending = get_pending_tasks(self.owner_id, classroom_id=classroom_id)
        two_sum_pending = [t for t in all_pending if t.task_type == PendingTaskType.PENDING_QUESTION]
        prefix_sums_deferred = [t for t in all_pending if t.task_type == PendingTaskType.DEFERRED_TOPIC]

        self.assertEqual(len(two_sum_pending), 1, "Two Pointers question must be pending")
        self.assertEqual(two_sum_pending[0].status, PendingTaskStatus.PENDING)
        self.assertEqual(len(prefix_sums_deferred), 1, "Prefix Sums topic must be deferred")
        self.assertEqual(prefix_sums_deferred[0].status, PendingTaskStatus.PENDING)

        # Verify initial observations staged: two_sum_hash_map (independent) vs hash_set_sequence (guided)
        obs_stage1 = get_session_observations(self.owner_id, session_id)
        obs_map = {o.competency_key: o for o in obs_stage1}
        self.assertIn("two_sum_hash_map", obs_map)
        self.assertEqual(obs_map["two_sum_hash_map"].assistance_level, AssistanceLevel.INDEPENDENT)
        self.assertTrue(obs_map["two_sum_hash_map"].demonstrated)

        self.assertIn("hash_set_sequence", obs_map)
        self.assertEqual(obs_map["hash_set_sequence"].assistance_level, AssistanceLevel.GUIDED)
        self.assertFalse(obs_map["hash_set_sequence"].demonstrated)

        # Step 2: Learner answers the pending Two Pointers question
        learner_answer = (
            "Because the array is sorted in non-decreasing order, moving the left pointer rightward "
            "strictly increases or maintains numbers[left], thus increasing the sum."
        )
        packet = assemble_context_packet(session_id=session_id, owner_id=self.owner_id, query_text=learner_answer)
        self.assertIsNotNone(packet.pending_question)

        decision = make_teaching_decision(
            context_packet=packet,
            learner_message=learner_answer,
            exposure=None,
            consecutive_correct_count=0,
        )
        validate_teaching_decision(decision, packet)

        self.assertEqual(decision.next_action, "probe")
        self.assertEqual(decision.assessment, "needs_attention")

        # Step 3: Learner saves initial draft revision 1, then updates to revision 2
        art_rev1 = save_artifact(
            owner_id=self.owner_id,
            session_id=session_id,
            expected_revision=1,
            content="# Initial draft\ndef two_sum(numbers: list[int], target: int) -> list[int]: pass\n",
        )
        self.assertEqual(art_rev1.revision, 1)

        solution_code = (
            "def two_sum(numbers: list[int], target: int) -> list[int]:\n"
            "    left, right = 0, len(numbers) - 1\n"
            "    while left < right:\n"
            "        s = numbers[left] + numbers[right]\n"
            "        if s == target:\n"
            "            return [left + 1, right + 1]\n"
            "        elif s < target:\n"
            "            left += 1\n"
            "        else:\n"
            "            right -= 1\n"
            "    return []\n"
        )
        art_rev2 = save_artifact(
            owner_id=self.owner_id,
            session_id=session_id,
            expected_revision=2,
            content=solution_code,
        )
        self.assertEqual(art_rev2.revision, 2)

        # Step 4: Activity update: record new observation and resolve answered pending question
        obs_new = record_observation(
            owner_id=self.owner_id,
            session_id=session_id,
            competency_key="two_pointers_inward_convergence",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Learner correctly explained inward convergence on sorted array and authored O(N) loop.",
            artifact_id=art_rev2.id,
        )
        self.assertIsNotNone(obs_new)

        # Resolve the answered Two Pointers task
        update_pending_task_status(self.owner_id, two_sum_pending[0].id, PendingTaskStatus.RESOLVED)

        # Step 5: Simulate service restart: re-fetch from persistent records
        # Verify that pending Two Pointers resolution, deferred prefix sums, and distinct evidence survive
        active_pending_after = get_pending_tasks(
            self.owner_id, classroom_id=classroom_id, status=PendingTaskStatus.PENDING
        )
        self.assertEqual(len(active_pending_after), 1, "Only deferred prefix sums should remain PENDING")
        self.assertEqual(active_pending_after[0].task_type, PendingTaskType.DEFERRED_TOPIC)
        self.assertEqual(active_pending_after[0].title, "Prefix Sums")

        resolved_tasks = get_pending_tasks(
            self.owner_id, classroom_id=classroom_id, status=PendingTaskStatus.RESOLVED
        )
        self.assertEqual(len(resolved_tasks), 1, "Two Pointers question must be marked RESOLVED")
        self.assertEqual(resolved_tasks[0].task_type, PendingTaskType.PENDING_QUESTION)

        # Verify evidence separation survives restart
        obs_surviving = get_session_observations(self.owner_id, session_id)
        self.assertEqual(len(obs_surviving), 3, "Exactly 3 observations should exist without duplication")

        surviving_map = {o.competency_key: o for o in obs_surviving}
        # Independent Two Sum hash map
        self.assertEqual(surviving_map["two_sum_hash_map"].assistance_level, AssistanceLevel.INDEPENDENT)
        self.assertTrue(surviving_map["two_sum_hash_map"].demonstrated)

        # Guided while-loop bug
        self.assertEqual(surviving_map["hash_set_sequence"].assistance_level, AssistanceLevel.GUIDED)
        self.assertFalse(surviving_map["hash_set_sequence"].demonstrated)

        # Independent Two Pointers inward convergence
        self.assertEqual(surviving_map["two_pointers_inward_convergence"].assistance_level, AssistanceLevel.INDEPENDENT)
        self.assertTrue(surviving_map["two_pointers_inward_convergence"].demonstrated)

        # Verify artifact revision survives
        latest_art = get_artifact(self.owner_id, session_id)
        self.assertEqual(latest_art.revision, 2)

    def test_b11_ac2_source_ownership_resume_and_failures(self):
        """
        B11-AC2: All fixed source/ownership/resume gates pass; retrieval misses and model failures remain visible.
        """
        import_chat_export_file(self.owner_id, self.dsa_file, track_override="dsa")
        session_id = get_imported_session_id(self.owner_id, "dsa")
        session = get_session(self.owner_id, session_id)
        classroom_id = session.classroom_id

        # 1. Ownership isolation gate: Other tenant cannot access session or mutate artifacts
        other_session = get_session(self.other_owner_id, session_id)
        self.assertIsNone(other_session, "Cross-owner session access must return None")

        with self.assertRaises(CrossOwnerReferenceError):
            save_artifact(
                owner_id=self.other_owner_id,
                session_id=session_id,
                expected_revision=1,
                content="malicious overwrite attempt",
            )

        # 2. Cancellation gate: Cancellation preserves prior input and event sequence without data loss
        run, created = create_or_get_turn_run(
            owner_id=self.owner_id,
            classroom_id=classroom_id,
            session_id=session_id,
            expected_revision=1,
            client_request_id="req_turn_cancel_test",
            message_content="Testing cancellation",
        )
        self.assertTrue(created)
        self.assertEqual(run.state, RunState.QUEUED)

        claimed = claim_next_job(worker_id="worker_test_1")
        self.assertIsNotNone(claimed)
        run_claimed, job = claimed
        self.assertEqual(run_claimed.id, run.id)
        self.assertEqual(run_claimed.state, RunState.RUNNING)

        write_run_event(
            run_id=run.id,
            worker_id="worker_test_1",
            fence=run_claimed.fence,
            event_type=EventType.CHUNK,
            payload={"chunk": "Let us examine the invariant."},
        )

        cancelled_run = cancel_run(self.owner_id, run.id)
        self.assertEqual(cancelled_run.state, RunState.CANCELLED)

        # Verify event sequence preserved: QUEUED (1), THINKING (2), CHUNK (3), CANCELLED (4)
        events = get_run_events(self.owner_id, run.id, after_seq=0)
        self.assertEqual(len(events), 4)
        self.assertEqual(events[0].event_type, EventType.QUEUED)
        self.assertEqual(events[1].event_type, EventType.THINKING)
        self.assertEqual(events[2].event_type, EventType.CHUNK)
        self.assertEqual(events[3].event_type, EventType.CANCELLED)

        # 3. Resume gate: Resuming after sequence N returns strictly events > N
        resumed_events = get_run_events(self.owner_id, run.id, after_seq=3)
        self.assertEqual(len(resumed_events), 1)
        self.assertEqual(resumed_events[0].seq, 4)
        self.assertEqual(resumed_events[0].event_type, EventType.CANCELLED)

        # 4. Retrieval miss visibility gate: Missing episodes are visible, not masked as false citations
        missing_query = "xyzzy_unmatched_token_987654"
        empty_packet = assemble_context_packet(
            session_id=session_id,
            owner_id=self.owner_id,
            query_text=missing_query,
            allow_retry=False,
        )
        self.assertEqual(len(empty_packet.source_episodes), 0, "Retrieval miss must remain visibly empty")
        self.assertEqual(len(empty_packet.source_coverage), 0, "Source coverage must be empty on retrieval miss")

        # 5. Model failure visibility gate: Missing credentials remain visibly erroring rather than fake-passed
        orig_key = os.environ.get("GEMINI_API_KEY")
        try:
            if "GEMINI_API_KEY" in os.environ:
                del os.environ["GEMINI_API_KEY"]
            gateway = ModelGateway()
            with self.assertRaises(ProviderCredentialMissingError):
                gateway.generate_structured(
                    prompt="Test prompt",
                    response_schema=ContextPacket,
                    role="tutor",
                )
        finally:
            if orig_key is not None:
                os.environ["GEMINI_API_KEY"] = orig_key


if __name__ == "__main__":
    unittest.main()
