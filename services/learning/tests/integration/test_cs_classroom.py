"""
Sprint B16: Integration Tests for CS Fundamentals Through Scenario Reasoning.
Authority: planly_architecture.md sections 2, 7-8; B16_cs_classroom.md

Enforces:
- B16-AC1: Resume unanswered follow-ups without pretending they were answered.
- B16-AC2: Distinguish shared address space concepts from the learner's demonstrated knowledge.
- B16-AC3: A CS observation cannot automatically alter unrelated DSA or ML mastery.
- Failure to Prevent: Do not replace the ongoing CS lesson with a generic syllabus dump.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    PendingTaskType,
    PendingTaskStatus,
    PendingTaskRecord,
)
from learning.repositories.evidence import (
    reset_evidence_store,
    record_observation,
    get_session_observations,
    create_classroom,
    create_session,
)
from learning.repositories.sources import (
    reset_sources_store,
    create_or_update_pending_task,
    get_pending_tasks,
)
from learning.learner.cs import (
    load_cs_curriculum,
    load_cs_activities,
    resume_unanswered_followup,
    evaluate_heap_memory_understanding,
    record_cs_scenario_observation,
    verify_track_isolation,
    detect_generic_syllabus_dump,
)


class TestCsClassroomIntegration(unittest.TestCase):

    def setUp(self):
        reset_evidence_store()
        reset_sources_store()
        self.owner_id = "owner_b16_cs"
        self.classroom_id = "cls_cs_fundamentals"
        self.session_id = "sess_cs_lesson_01"

        # Create classrooms and active sessions in evidence store
        create_classroom(self.owner_id, track="cs", title="CS Fundamentals", classroom_id=self.classroom_id)
        create_session(self.owner_id, self.classroom_id, session_id=self.session_id)

        create_classroom(self.owner_id, track="dsa", title="DSA Track", classroom_id="cls_dsa")
        create_session(self.owner_id, "cls_dsa", session_id="sess_dsa_track_01")

        create_classroom(self.owner_id, track="ai_ml", title="ML Track", classroom_id="cls_ml")
        create_session(self.owner_id, "cls_ml", session_id="sess_ml_track_01")

    def test_b16_ac1_resume_unanswered_followups_without_fabrication(self):
        """
        B16-AC1: Resuming an unanswered follow-up (e.g. Q11-Q15 from chat import)
        must present the question as open and unattempted, without assuming
        it was answered or fabricating learner responses.
        """
        # Create imported pending follow-up task
        task, _ = create_or_update_pending_task(
            owner_id=self.owner_id,
            classroom_id=self.classroom_id,
            session_id=self.session_id,
            task_type=PendingTaskType.UNANSWERED_FOLLOWUP,
            title="Unanswered follow-ups: Q11-Q15 on thread memory and OS primitives",
            prompt_text="Answer Q11-Q15 on thread memory and OS primitives",
            context_json={
                "pending_questions": [
                    "Q11: When two threads access a shared pointer, does writing require OS page table mutation?",
                    "Q12: If thread A encounters a segmentation fault, does the entire process crash?",
                ],
            },
        )
        self.assertEqual(task.status, PendingTaskStatus.PENDING)

        # Resume the follow-up task
        resumed = resume_unanswered_followup(
            owner_id=self.owner_id,
            task_id=task.id,
            classroom_id=self.classroom_id,
        )

        self.assertEqual(resumed["status"], "pending")
        self.assertFalse(resumed["is_assumed_answered"], "Must not assume follow-up was answered")
        self.assertFalse(resumed["fabricated_responses"], "Must not fabricate learner responses")
        self.assertEqual(resumed["action_required"], "learner_response_required")
        self.assertEqual(len(resumed["pending_questions"]), 2)
        self.assertIn("Q11", resumed["pending_questions"][0])

    def test_b16_ac2_distinguish_shared_address_space_concepts_from_demonstrated_knowledge(self):
        """
        B16-AC2: Keep the heap correction as tutor reference until learner evidence
        demonstrates understanding. Distinguish concept presence in reference material
        from the learner's demonstrated knowledge.
        """
        # 1. Imported tutor explanation (heap vs stack memory model) from B05
        tutor_ref_obs = record_observation(
            owner_id=self.owner_id,
            session_id=self.session_id,
            competency_key="process_thread_memory_model",
            source_kind=SourceKind.TUTOR_EXPLANATION,
            assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            demonstrated=False,  # Tutor explanation is NOT learner demonstration
            evidence_text="Tutor explained that heap memory is shared across threads in a process address space.",
        )
        self.assertFalse(tutor_ref_obs.demonstrated)
        self.assertEqual(tutor_ref_obs.assistance_level, AssistanceLevel.TUTOR_SUPPLIED)

        # 2. Incomplete or vague learner response does NOT unlock demonstration
        vague_response = "Memory is stored somewhere in the computer and variables can be read."
        success, obs = evaluate_heap_memory_understanding(
            owner_id=self.owner_id,
            session_id=self.session_id,
            learner_response=vague_response,
            prior_tutor_reference_obs=tutor_ref_obs,
        )
        self.assertFalse(success)
        self.assertIsNone(obs)

        # 3. Learner independently articulates the core memory model invariant:
        # Heap resides in process virtual address space, surviving thread stack frame pop.
        strong_learner_response = (
            "Yes, Thread 2 can still access the 10MB buffer because the heap belongs to the "
            "entire process virtual address space, persisting even after Thread 1 exits its stack frame. "
            "Individual thread stacks are destroyed on thread exit, but the heap remains valid until freed."
        )
        success, demonstrated_obs = evaluate_heap_memory_understanding(
            owner_id=self.owner_id,
            session_id=self.session_id,
            learner_response=strong_learner_response,
            prior_tutor_reference_obs=tutor_ref_obs,
        )
        self.assertTrue(success)
        self.assertIsNotNone(demonstrated_obs)
        self.assertTrue(demonstrated_obs.demonstrated)
        self.assertEqual(demonstrated_obs.assistance_level, AssistanceLevel.INDEPENDENT)
        self.assertEqual(demonstrated_obs.source_kind, SourceKind.LEARNER_WORK)

        # 4. Invariant check: The original tutor reference observation was NOT mutated
        current_obs = get_session_observations(self.owner_id, self.session_id)
        original = next(o for o in current_obs if o.id == tutor_ref_obs.id)
        self.assertFalse(original.demonstrated, "Tutor reference must remain demonstrated=False")

    def test_b16_ac3_cs_observation_cannot_alter_unrelated_dsa_or_ml_mastery(self):
        """
        B16-AC3: A CS observation cannot automatically alter unrelated DSA or ML mastery.
        Cross-track isolation must be strictly maintained.
        """
        dsa_session_id = "sess_dsa_track_01"
        ml_session_id = "sess_ml_track_01"

        # Baseline DSA: learner demonstrated two_sum_hash_map
        record_observation(
            owner_id=self.owner_id,
            session_id=dsa_session_id,
            competency_key="two_sum_hash_map",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Solved Two Sum with hash map in O(N)",
        )

        # Baseline ML: unsubmitted (0 demonstrated competencies)
        record_observation(
            owner_id=self.owner_id,
            session_id=ml_session_id,
            competency_key="ml_numpy_regression",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.UNASSESSED,
            demonstrated=False,
            evidence_text="NumPy regression exercise unsubmitted",
        )

        initial_dsa_keys = ["two_sum_hash_map"]
        initial_ml_keys = []

        # Record multiple CS scenario observations in the CS session
        record_cs_scenario_observation(
            owner_id=self.owner_id,
            session_id=self.session_id,
            competency_key="cs.scenario.race_conditions",
            demonstrated=True,
            evidence_text="Candidate independently traced assembly-level non-atomic lost updates on counter.",
        )
        record_cs_scenario_observation(
            owner_id=self.owner_id,
            session_id=self.session_id,
            competency_key="cs.scenario.critical_sections",
            demonstrated=True,
            evidence_text="Candidate correctly defined critical section boundaries and deadlock exception safety.",
        )

        # Verify that CS observations did NOT alter DSA or ML mastery
        isolation = verify_track_isolation(
            owner_id=self.owner_id,
            dsa_session_id=dsa_session_id,
            ml_session_id=ml_session_id,
            initial_dsa_keys=initial_dsa_keys,
            initial_ml_keys=initial_ml_keys,
        )

        self.assertTrue(isolation["isolation_preserved"])
        self.assertTrue(isolation["dsa_intact"])
        self.assertTrue(isolation["ml_intact"])
        self.assertEqual(isolation["dsa_verified_keys"], ["two_sum_hash_map"])
        self.assertEqual(isolation["ml_verified_keys"], [])

    def test_b16_cs_curriculum_and_activities_pass_validation(self):
        """
        Verifies that the CS curriculum graph is a valid DAG and all CS activities
        pass schema validation with exact SHA-256 content hashes.
        """
        curriculum = load_cs_curriculum()
        self.assertGreaterEqual(len(curriculum.skills), 5)
        self.assertIn("cs.terminology.process_vs_thread", curriculum.skills)
        self.assertIn("cs.explanation.memory_models", curriculum.skills)
        self.assertIn("cs.scenario.shared_address_space", curriculum.skills)
        self.assertIn("cs.scenario.race_conditions", curriculum.skills)
        self.assertIn("cs.scenario.critical_sections", curriculum.skills)

        activities = load_cs_activities()
        self.assertEqual(len(activities), 4)

        activity_ids = [a.id for a in activities]
        self.assertIn("act_cs_process_vs_thread", activity_ids)
        self.assertIn("act_cs_memory_heap_stack", activity_ids)
        self.assertIn("act_cs_race_condition_counter", activity_ids)
        self.assertIn("act_cs_critical_section_lock", activity_ids)

        for act in activities:
            self.assertEqual(act.track, "cs")
            self.assertTrue(act.evaluator.rubric)
            self.assertGreater(len(act.evaluator.test_cases), 0)

    def test_b16_failure_to_prevent_no_syllabus_dump(self):
        """
        Failure to Prevent:
        Do not replace the ongoing CS lesson with a generic syllabus dump.
        """
        # Focused scenario explanation (valid)
        scenario_response = (
            "Let's look at what happens when thread 1 executes `counter += 1`. "
            "At the hardware level, this compiles to three instructions: load, add, and store. "
            "If thread 2 interrupts between load and store, what value does thread 2 see?"
        )
        self.assertFalse(detect_generic_syllabus_dump(scenario_response))

        # Massive textbook syllabus dump (invalid)
        syllabus_dump = "\n".join([
            "Chapter 1: Operating Systems Overview",
            "Chapter 2: Processes and Threads",
            "Chapter 3: CPU Scheduling",
            "Chapter 4: Process Synchronization",
            "Chapter 5: Deadlocks",
            "Chapter 6: Memory Management",
            "Chapter 7: Virtual Memory",
            "Chapter 8: File Systems",
            "Chapter 9: I/O Systems",
            "Chapter 10: Security and Protection",
        ] + [f"- Module {i}: Advanced concepts in OS" for i in range(15)])
        self.assertTrue(detect_generic_syllabus_dump(syllabus_dump))


if __name__ == "__main__":
    unittest.main()
