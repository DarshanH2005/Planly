"""
Automated Boundary Tests for Curriculum, Micro-Skills, Exposure & Activities.
Sprint: B12
Authority: planly_architecture.md sections 7, 9, 12; B12_curriculum_exposure.md

Enforces:
- B12-AC1: Invalid/orphan skill edges and inconsistent content versions fail validation.
- B12-AC2: Familiar or solution-exposed variants cannot qualify as unseen transfer.
- B12-AC3: A catalog gap yields verified review/repair or an explicit gap, not fabricated progress.
- Failure to prevent: Advanced catalog items cannot skip beginner prerequisite order.
"""

import os
import sys
import unittest
import json
import tempfile
import subprocess
from pathlib import Path

# Add services/learning to sys.path
SERVICES_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.activities import (
    CurriculumGraph,
    MicroSkill,
    ActivityDemands,
    CandidateProjection,
    EvaluatorProjection,
    ActivityProvenance,
    ExposureState,
    VerifiedActivity,
    ReviewStatus,
    CurriculumGraphValidationError,
    ActivitySelector,
    NoEligibleActivityRecord,
)

CURRICULUM_FILE = SERVICES_DIR / "learning" / "content" / "curriculum.json"
ACTIVITIES_DIR = SERVICES_DIR / "learning" / "content" / "activities"


class TestCurriculumActivities(unittest.TestCase):
    def setUp(self):
        # Load canonical curriculum
        self.assertTrue(CURRICULUM_FILE.exists(), f"Curriculum file {CURRICULUM_FILE} must exist")
        with open(CURRICULUM_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.curriculum = CurriculumGraph()
        for s in data["skills"]:
            self.curriculum.add_skill(MicroSkill(**s))

        # Load canonical activities
        self.activities = []
        for file_path in sorted(ACTIVITIES_DIR.glob("*.json")):
            with open(file_path, "r", encoding="utf-8") as f:
                self.activities.append(VerifiedActivity(**json.load(f)))

        self.selector = ActivitySelector(self.curriculum, self.activities)

    def test_b12_ac1_canonical_curriculum_and_content_are_valid(self):
        """B12-AC1: Canonical curriculum graph and activities pass all validation rules."""
        # 1. Graph validation passes with zero errors
        self.curriculum.validate()
        self.assertGreaterEqual(len(self.curriculum.skills), 8)

        # 2. All canonical activities have matching content hashes
        for act in self.activities:
            computed_hash = act.compute_content_hash()
            self.assertEqual(
                act.provenance.content_hash,
                computed_hash,
                f"Activity {act.id} content_hash must match computed hash",
            )
            # Skill must exist in graph
            self.assertIn(act.micro_skill_id, self.curriculum.skills)

    def test_b12_ac1_orphan_edge_fails_validation(self):
        """B12-AC1: Orphan prerequisite edges pointing to non-existent skills fail validation."""
        broken_graph = CurriculumGraph()
        broken_graph.add_skill(
            MicroSkill(
                id="dsa.arrays.basic",
                name="Basic Arrays",
                category="arrays",
                description="Testing",
                prerequisites=["dsa.nonexistent.parent_skill_12345"],
            )
        )

        with self.assertRaises(CurriculumGraphValidationError) as ctx:
            broken_graph.validate()

        errors = ctx.exception.errors
        self.assertEqual(len(errors), 1)
        self.assertIn("Orphan prerequisite edge", errors[0])
        self.assertIn("dsa.nonexistent.parent_skill_12345", errors[0])

    def test_b12_ac1_cycle_fails_validation(self):
        """B12-AC1: Cycles in prerequisite edges fail validation (graph must be DAG)."""
        cyclic_graph = CurriculumGraph()
        cyclic_graph.add_skill(
            MicroSkill(id="skill_a", name="Skill A", category="cat", description="A", prerequisites=["skill_b"])
        )
        cyclic_graph.add_skill(
            MicroSkill(id="skill_b", name="Skill B", category="cat", description="B", prerequisites=["skill_c"])
        )
        cyclic_graph.add_skill(
            MicroSkill(id="skill_c", name="Skill C", category="cat", description="C", prerequisites=["skill_a"])
        )

        with self.assertRaises(CurriculumGraphValidationError) as ctx:
            cyclic_graph.validate()

        errors = ctx.exception.errors
        self.assertTrue(any("Cycle detected" in err for err in errors))

    def test_b12_ac1_content_hash_mismatch_detected(self):
        """B12-AC1: Inconsistent content version / altered statement is caught by hash verification."""
        act = self.activities[0].model_copy(deep=True)
        original_hash = act.compute_content_hash()

        # Tamper with candidate statement
        act.candidate.statement = "TAMPERED STATEMENT REQUIRING CHEATING CODE"
        tampered_hash = act.compute_content_hash()

        self.assertNotEqual(original_hash, tampered_hash)
        self.assertNotEqual(act.provenance.content_hash, tampered_hash)

    def test_b12_ac2_familiar_and_solution_exposed_cannot_qualify_as_unseen(self):
        """
        B12-AC2: Familiar statements, close variants, or solution-exposed problems cannot qualify as unseen transfer.
        """
        skill_id = "dsa.two_pointers.inward_convergence"
        demonstrated = {"dsa.arrays.iteration", "dsa.two_pointers.basics"}

        # 1. Condition A: Learner has had solution exposed on Two Sum Sorted
        exposures_sol = {
            "act_dsa_two_sum_sorted": ExposureState(
                solution_exposed=True,
                seen_statement=True,
                last_seen_mode="learn",
            )
        }
        act, gap = self.selector.select_next_activity(
            target_skill_id=skill_id,
            demonstrated_skills=demonstrated,
            exposures=exposures_sol,
            require_unseen_transfer=True,
        )
        self.assertIsNone(act, "Solution-exposed activity must NOT be selected for unseen transfer")
        self.assertIsNotNone(gap)
        self.assertEqual(gap.recommended_action, "content_gap_disclosed")
        self.assertIn("solutions exposed", gap.reason)

        # 2. Condition B: Learner has seen the exact statement
        exposures_seen = {
            "act_dsa_two_sum_sorted": ExposureState(
                seen_statement=True,
                solution_exposed=False,
            )
        }
        act, gap = self.selector.select_next_activity(
            target_skill_id=skill_id,
            demonstrated_skills=demonstrated,
            exposures=exposures_seen,
            require_unseen_transfer=True,
        )
        self.assertIsNone(act, "Seen statement must NOT be selected for unseen transfer")
        self.assertIsNotNone(gap)

        # 3. Condition C: Learner has seen a close variant
        exposures_variant = {
            "act_dsa_two_sum_sorted": ExposureState(
                close_variant=True,
            )
        }
        act, gap = self.selector.select_next_activity(
            target_skill_id=skill_id,
            demonstrated_skills=demonstrated,
            exposures=exposures_variant,
            require_unseen_transfer=True,
        )
        self.assertIsNone(act, "Close variant must NOT be selected for unseen transfer")
        self.assertIsNotNone(gap)

        # 4. Condition D: Completely unseen activity qualifies for unseen transfer
        exposures_clean = {}
        act, gap = self.selector.select_next_activity(
            target_skill_id=skill_id,
            demonstrated_skills=demonstrated,
            exposures=exposures_clean,
            require_unseen_transfer=True,
        )
        self.assertIsNotNone(act, "Unseen activity must qualify for unseen transfer")
        self.assertEqual(act.id, "act_dsa_two_sum_sorted")
        self.assertIsNone(gap)

    def test_b12_ac3_catalog_gap_yields_review_or_explicit_gap_never_fabricated_progress(self):
        """
        B12-AC3: Missing prerequisites yield review_prerequisite recommendation;
        unverified catalog problems or exhausted catalog yield explicit gap, never fabricated progress.
        """
        # Scenario 1: Prerequisites NOT demonstrated (Failure to Prevent: advanced cannot skip fundamentals)
        # Target: Two Pointers Inward Convergence (requires dsa.two_pointers.basics)
        # Learner has NO demonstrated skills
        act, gap = self.selector.select_next_activity(
            target_skill_id="dsa.two_pointers.inward_convergence",
            demonstrated_skills=set(),
            exposures={},
            require_unseen_transfer=False,
        )
        self.assertIsNone(act)
        self.assertIsNotNone(gap)
        self.assertEqual(gap.recommended_action, "review_prerequisite")
        self.assertEqual(gap.gap_skill_id, "dsa.two_pointers.basics")
        self.assertIn("Prerequisite 'dsa.two_pointers.basics' has not been demonstrated", gap.reason)

        # Scenario 2: Target skill is completely missing from curriculum
        act, gap = self.selector.select_next_activity(
            target_skill_id="dsa.quantum.shors_algorithm",
            demonstrated_skills={"dsa.arrays.iteration"},
            exposures={},
        )
        self.assertIsNone(act)
        self.assertIsNotNone(gap)
        self.assertEqual(gap.recommended_action, "content_gap_disclosed")

        # Scenario 3: Catalog item is catalogued_unverified (e.g. ARR3-04 Inversion Counting)
        # Even if prerequisites are met, unverified target problem cannot be scheduled as verified_ready
        act, gap = self.selector.select_next_activity(
            target_skill_id="dsa.advanced.inversion_counting",
            demonstrated_skills={
                "dsa.arrays.iteration",
                "dsa.two_pointers.basics",
                "dsa.two_pointers.merge",
                "dsa.sorting.merge_sort",
            },
            exposures={},
        )
        self.assertIsNone(act, "Catalogued unverified item must NOT be assigned as verified ready")
        self.assertIsNotNone(gap)
        self.assertEqual(gap.recommended_action, "content_gap_disclosed")
        self.assertIn("unverified", gap.reason)


if __name__ == "__main__":
    unittest.main()
