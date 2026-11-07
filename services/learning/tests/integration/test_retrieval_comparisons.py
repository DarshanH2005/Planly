"""
Sprint B24: Controlled Retrieval Comparisons Integration Tests
Authority: PLANLY_BUILD_SPEC.md §3, §6, §11, §14; B24_retrieval_comparisons.md

Tests:
- B24-AC1: No future-derived memory contaminates replay cases.
- B24-AC2: A model swap or extra prompt cannot be reported as a retrieval improvement.
- B24-AC3: Inconclusive or worse results retain the existing configuration with measured findings.
- Failure to Prevent: Comparison code must not spend without a declared budget.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from evals.retrieval.metrics import (
    compute_reciprocal_rank,
    compute_ndcg_at_k,
    compute_recall_at_k,
    check_future_memory_leakage,
)
from evals.retrieval.comparator import (
    EvaluationConfig,
    compare_retrieval_pipelines,
    run_adapter_evaluation,
    setup_evaluation_indexer,
    load_held_out_cases,
)
from learning.domain.contracts import EpisodeRecord, RetrievalCandidate
from learning.retrieval.hybrid import RetrievalFilter
from learning.retrieval.adapters import get_retrieval_adapter


class TestRetrievalComparisons(unittest.TestCase):
    def setUp(self):
        self.held_out_cases = load_held_out_cases()
        self.indexer = setup_evaluation_indexer(self.held_out_cases)

    def test_b24_ac1_no_future_derived_memory_contaminates_replay_cases(self):
        """
        B24-AC1: No future-derived memory contaminates replay cases.
        Episodes created after the query timestamp must be strictly excluded.
        """
        eval_config = EvaluationConfig(declared_budget_usd=0.25)

        for adapter_name in ["baseline_hybrid", "gemini_embedding_2", "graph_expanded_hybrid"]:
            eval_result = run_adapter_evaluation(
                adapter_name=adapter_name,
                cases=self.held_out_cases,
                indexer=self.indexer,
                eval_config=eval_config,
            )
            # Must have zero future leakage
            self.assertEqual(
                eval_result["future_leakage_count"],
                0,
                f"Adapter '{adapter_name}' leaked future memory into replay cases (B24-AC1)",
            )
            self.assertEqual(eval_result["leaked_ids"], [])

        # Negative test: simulated candidate containing future leakage is detected
        leaked_candidate = RetrievalCandidate(
            episode=EpisodeRecord(
                id="ep_future_leak_sim",
                title="Future Memory",
                content="Contains future answer",
                created_at="2026-09-20T00:00:00Z",
            ),
            score=0.95,
            lexical_rank=1,
            vector_rank=1,
            rrf_score=0.033,
        )
        detected = check_future_memory_leakage([leaked_candidate], cutoff_timestamp="2026-09-10T12:00:00Z")
        self.assertEqual(detected, ["ep_future_leak_sim"])

    def test_b24_ac2_model_swap_or_extra_prompt_cannot_be_reported_as_retrieval_improvement(self):
        """
        B24-AC2: A model swap or extra prompt cannot be reported as a retrieval improvement.
        Generator model and prompt template must be held strictly constant.
        """
        base_model = "gemini-3.8-flash"
        base_prompt = "standard_tutor_decision_v1"

        # 1. Swapped generator model during evaluation must be rejected
        swapped_model_config = EvaluationConfig(
            declared_budget_usd=0.25,
            generator_model="gemini-1.5-pro",  # Swapped generator model!
            prompt_template=base_prompt,
        )
        with self.assertRaises(ValueError) as ctx:
            run_adapter_evaluation(
                adapter_name="baseline_hybrid",
                cases=self.held_out_cases,
                indexer=self.indexer,
                eval_config=swapped_model_config,
                base_generator_model=base_model,
                base_prompt_template=base_prompt,
            )
        self.assertIn("A model swap or extra prompt cannot be reported", str(ctx.exception))
        self.assertIn("B24-AC2", str(ctx.exception))

        # 2. Extra prompt variation must also be rejected
        varied_prompt_config = EvaluationConfig(
            declared_budget_usd=0.25,
            generator_model=base_model,
            prompt_template="extra_cot_prompt_engineering_v2",  # Varied prompt!
        )
        with self.assertRaises(ValueError) as ctx2:
            run_adapter_evaluation(
                adapter_name="baseline_hybrid",
                cases=self.held_out_cases,
                indexer=self.indexer,
                eval_config=varied_prompt_config,
                base_generator_model=base_model,
                base_prompt_template=base_prompt,
            )
        self.assertIn("A model swap or extra prompt cannot be reported", str(ctx2.exception))
        self.assertIn("B24-AC2", str(ctx2.exception))

    def test_b24_ac3_inconclusive_or_worse_results_retain_existing_configuration(self):
        """
        B24-AC3: Inconclusive or worse results retain the existing configuration with measured findings.
        """
        report = compare_retrieval_pipelines(
            candidate_names=["gemini_embedding_2", "graph_expanded_hybrid"],
            declared_budget_usd=0.50,
        )

        # Baseline should be evaluated
        self.assertIn("baseline", report)
        self.assertIn("candidates", report)

        # When candidate metrics do not meet the minimum delta (+0.05),
        # decision must be RETAIN_BASELINE
        decisions = report["decisions"]
        for cand_name, dec in decisions.items():
            if not dec["passes_quality"]:
                self.assertEqual(dec["decision"], "RETAIN_BASELINE")
                self.assertIn("Retain baseline", dec["action"])

        self.assertEqual(report["retained_active_configuration"], "baseline_hybrid")

    def test_b24_failure_to_prevent_missing_budget_rejected(self):
        """
        Failure to Prevent: Published SOTA scores do not make a local adapter the winner,
        and comparison code must not spend without a declared budget.
        """
        with self.assertRaises(ValueError) as ctx:
            compare_retrieval_pipelines(
                candidate_names=["gemini_embedding_2"],
                declared_budget_usd=0.0,
            )
        self.assertIn("must not spend without a declared budget", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx2:
            compare_retrieval_pipelines(
                candidate_names=["gemini_embedding_2"],
                declared_budget_usd=-0.10,
            )
        self.assertIn("must not spend without a declared budget", str(ctx2.exception))

    def test_b24_metrics_calculation_accuracy(self):
        """
        Verifies correct implementation of IR evaluation metrics (NDCG@k, MRR, Recall@k).
        """
        gold_ids = {"doc_1", "doc_2"}
        gold_grades = {"doc_1": 3, "doc_2": 2}

        # Perfect ranking: [doc_1, doc_2, doc_3]
        mrr_perfect = compute_reciprocal_rank(["doc_1", "doc_2", "doc_3"], gold_ids)
        self.assertEqual(mrr_perfect, 1.0)

        ndcg_perfect = compute_ndcg_at_k(["doc_1", "doc_2", "doc_3"], gold_grades, k=3)
        self.assertEqual(ndcg_perfect, 1.0)

        recall_perfect = compute_recall_at_k(["doc_1", "doc_2", "doc_3"], gold_ids, k=2)
        self.assertEqual(recall_perfect, 1.0)

        # Sub-optimal ranking: [doc_3, doc_2, doc_1]
        mrr_sub = compute_reciprocal_rank(["doc_3", "doc_2", "doc_1"], gold_ids)
        self.assertEqual(mrr_sub, 0.5)  # first gold is at rank 2 -> 1/2 = 0.5

        recall_sub = compute_recall_at_k(["doc_3", "doc_2"], gold_ids, k=2)
        self.assertEqual(recall_sub, 0.5)  # 1 out of 2 gold documents retrieved in top 2


if __name__ == "__main__":
    unittest.main()
