"""
Integration Test Suite for Sprint B19: Technical Interview Dialogue and Explanation Rubric.
Authority: PLANLY_BUILD_SPEC.md §16-17; B19_technical_interview.md

Acceptance Criteria:
- B19-AC1: The interviewer follows the learner's approach rather than revealing the reference solution.
- B19-AC2: A weak complexity explanation remains a specific gap despite passing code tests.
- B19-AC3: Mode restrictions and resume preserve stage and evidence.
- Failure to Prevent: Do not treat eloquent generated summaries as the learner's explanation performance.
"""

import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone

# Add services/learning to path
SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import SessionMode, AssistanceLevel
from learning.workflows.interview import (
    initialize_interview_session,
    get_interview_state,
    execute_interview_turn,
    resume_interview_session,
    reset_interview_storage,
    InterviewStage,
    InterviewTurnRole,
)

OWNER_ID = "00000000-0000-0000-0000-000000000001"
CLASSROOM_ID = "11111111-1111-1111-1111-111111111111"


class TestTechnicalInterviewWorkflow(unittest.TestCase):
    def setUp(self):
        reset_interview_storage()

    # ==========================================================================
    # B19-AC1: Interviewer Follows Learner Approach Without Revealing Solution
    # ==========================================================================

    def test_b19_ac1_interviewer_follows_learner_approach(self):
        """
        B19-AC1:
        1. Initialize interview in strict mode.
        2. Candidate asks clarification question; interviewer responds without giving away solution.
        3. Candidate proposes a sorting approach.
        4. Interviewer follows the candidate's chosen sorting approach (probing about index destruction)
           rather than forcing a hash map or reciting the canonical reference code.
        """
        state = initialize_interview_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            scenario_id="tech_interview_first_repeating",
            mode=SessionMode.STRICT,
        )
        self.assertEqual(state.current_stage, InterviewStage.CLARIFICATION)
        self.assertFalse(state.rubric.approach_demonstrated)

        # 1. Candidate clarifies constraints
        state, reply1, dec1 = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="Can nums contain negative numbers or zeros?",
        )
        self.assertIn("positive, negative, and zero", reply1.lower())
        self.assertEqual(state.current_stage, InterviewStage.CLARIFICATION)

        # 2. Advance to approach discussion
        state, reply2, dec2 = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="Got it. I am ready to discuss my approach.",
        )
        self.assertEqual(state.current_stage, InterviewStage.APPROACH)
        self.assertIn("approach", reply2.lower())

        # 3. Candidate proposes sorting approach
        state, reply_sort, dec_sort = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="I plan to sort the array first, so any duplicate elements will be next to each other.",
        )
        # Verify interviewer explores candidate's chosen approach
        self.assertTrue(state.rubric.approach_demonstrated)
        self.assertEqual(state.rubric.approach_type, "sorting")
        self.assertIn("sort", reply_sort.lower())
        self.assertIn("indices", reply_sort.lower())
        # Invariant: interviewer did NOT prescribe or leak the canonical hash map solution
        self.assertNotIn("def first_repeat", reply_sort)
        self.assertNotIn("seen = set()", reply_sort)

    # ==========================================================================
    # B19-AC2: Weak Complexity Explanation Remains a Specific Gap
    # ==========================================================================

    def test_b19_ac2_weak_complexity_remains_specific_gap_despite_passing_tests(self):
        """
        B19-AC2:
        1. Candidate implements solution using a hash set.
        2. Candidate code passes functional checks (code_tests_passed = True).
        3. Candidate claims time is O(n), but claims space is O(1) space.
        4. Evaluator detects space complexity misconception: allocating a hash set is O(n), not O(1).
        5. Specific gap 'complexity.space_hash_set_underestimated' is recorded in the rubric.
        6. Passing code tests does NOT clear or hide this complexity gap!
        """
        state = initialize_interview_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            scenario_id="tech_interview_first_repeating",
            mode=SessionMode.STRICT,
        )

        # Advance through clarification and approach
        execute_interview_turn(state.session_id, "I am ready to propose my approach.")
        execute_interview_turn(state.session_id, "I will use a hash set called seen to store elements in a single pass.")

        self.assertEqual(state.current_stage, InterviewStage.IMPLEMENTATION)

        # Candidate submits valid code
        valid_code = (
            "def first_repeat(nums):\n"
            "    seen = set()\n"
            "    for x in nums:\n"
            "        if x in seen:\n"
            "            return x\n"
            "        seen.add(x)\n"
            "    return None\n"
        )
        state, reply_code, _ = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="I have finished implementing the code.",
            candidate_code=valid_code,
        )

        # Code passed!
        self.assertTrue(state.rubric.code_tests_passed)
        self.assertEqual(state.current_stage, InterviewStage.COMPLEXITY)

        # Candidate provides flawed complexity analysis: claims O(1) space for hash set
        state, reply_comp, _ = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="The time complexity is O(n) and space is O(1) space because we only use one seen set.",
        )

        # Invariant B19-AC2:
        # Code tests passed, but complexity_verified MUST be False!
        self.assertTrue(state.rubric.code_tests_passed)
        self.assertFalse(state.rubric.complexity_verified)

        # Specific gap must exist in rubric
        gap_keys = [g.gap_key for g in state.rubric.specific_gaps]
        self.assertIn("complexity.space_hash_set_underestimated", gap_keys)

        gap = next(g for g in state.rubric.specific_gaps if g.gap_key == "complexity.space_hash_set_underestimated")
        self.assertFalse(gap.resolved)
        self.assertEqual(gap.aspect, "complexity_analysis")
        self.assertIn("N distinct elements", gap.description)

        # Interviewer probe addresses the specific gap
        self.assertIn("seen set store", reply_comp.lower())

    # ==========================================================================
    # B19-AC3: Mode Restrictions and Resume Preserve Stage and Evidence
    # ==========================================================================

    def test_b19_ac3_mode_restrictions_and_resume_preserve_state(self):
        """
        B19-AC3:
        1. In strict mode, asking for hints or solutions is declined without leaking answers.
        2. Candidate disconnects / network interrupt occurs.
        3. Resuming interview reloads exact stage, turn history, code snapshot, and specific gaps.
        """
        state = initialize_interview_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            scenario_id="tech_interview_first_repeating",
            mode=SessionMode.STRICT,
        )
        execute_interview_turn(state.session_id, "I'm ready for approach.")
        execute_interview_turn(state.session_id, "I will use a hash set.")
        self.assertEqual(state.current_stage, InterviewStage.IMPLEMENTATION)

        # Candidate asks for hints in strict mode
        state, reply_hint, _ = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="Can you give me a hint or tell me the solution? I am stuck.",
        )
        # Strict mode prevents hint generation
        self.assertIn("independently", reply_hint.lower())
        self.assertNotIn("def first_repeat", reply_hint)

        turn_count_before = len(state.turns)

        # Simulate interruption and resume
        resumed = resume_interview_session(state.session_id, OWNER_ID)
        self.assertTrue(resumed.is_interrupted)
        self.assertEqual(resumed.current_stage, InterviewStage.IMPLEMENTATION)
        self.assertEqual(len(resumed.turns), turn_count_before)
        self.assertEqual(resumed.rubric.approach_type, "hash_set")

    # ==========================================================================
    # Failure to Prevent: Do Not Treat Eloquent Summaries as Learner Performance
    # ==========================================================================

    def test_failure_to_prevent_vague_explanation_rejected(self):
        """
        Failure to Prevent:
        Vague hand-waving responses like "my code runs very fast and is optimal"
        must NOT be given credit for complexity analysis.
        """
        state = initialize_interview_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            scenario_id="tech_interview_first_repeating",
            mode=SessionMode.STRICT,
        )
        execute_interview_turn(state.session_id, "Ready for approach.")
        execute_interview_turn(state.session_id, "I will use a set.")
        execute_interview_turn(
            state.session_id,
            "Code is done.",
            candidate_code="def first_repeat(nums):\n    return None\n",
        )
        self.assertEqual(state.current_stage, InterviewStage.COMPLEXITY)

        # Candidate gives vague hand-wavy response without Big-O
        state, reply_vague, _ = execute_interview_turn(
            session_id=state.session_id,
            candidate_message="The algorithm is super fast and uses minimal memory.",
        )

        self.assertFalse(state.rubric.complexity_verified)
        gap_keys = [g.gap_key for g in state.rubric.specific_gaps]
        self.assertIn("complexity.explanation_vague_or_missing", gap_keys)


if __name__ == "__main__":
    unittest.main()
