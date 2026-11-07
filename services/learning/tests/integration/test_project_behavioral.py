"""
Sprint B20 Integration Tests: Project, Design and Behavioural Interview Practice.
Authority: PLANLY_BUILD_SPEC.md §8, 14, 20; B20_project_behavioral.md

Verifies:
- B20-AC1: Missing users, deployment or impact data remains unknown rather than invented.
- B20-AC2: A follow-up references an actual artifact/answer and preserves source IDs.
- B20-AC3: Project/behavioural evidence does not change algorithm readiness automatically.
- Failure to Prevent: Role-specific practice is not an official company interview
  unless supported by attributable current requirements.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.workflows.project_review import (
    ProjectArtifact,
    ProjectProvenance,
    MetricStatus,
    audit_project_metrics,
    create_project_review_session,
    execute_project_review_turn,
    evaluate_project_rubrics_and_observations,
    verify_algorithm_readiness_isolation,
    route_gaps_to_study_activities,
    ProjectGap,
)
from learning.repositories import evidence
from learning.domain.contracts import AssistanceLevel, SourceKind

OWNER_ID = "00000000-0000-0000-0000-000000000001"


class TestProjectBehavioralReview(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        self.cls = evidence.create_classroom(
            owner_id=OWNER_ID,
            track="engineering",
            title="Project Defense & Behavioral",
        )
        self.raw_artifact = ProjectArtifact(
            id="art_proj_001",
            owner_id=OWNER_ID,
            title="Event-Driven Distributed Pipeline",
            summary="High-throughput asynchronous ingestion stream with deduplication.",
            architecture_overview="Kafka -> Redis deduplication window -> PostgreSQL Outbox -> Debezium CDC",
            tech_stack=["Python", "FastAPI", "Kafka", "Redis", "PostgreSQL"],
            key_decisions=[
                {
                    "decision_id": "dec_redis_dedup",
                    "choice": "Redis sliding TTL window with SETNX idempotency keys",
                    "rationale": "Sub-millisecond deduplication checks at ingestion gate",
                },
                {
                    "decision_id": "dec_outbox",
                    "choice": "Transactional Outbox in PostgreSQL",
                    "rationale": "Guaranteed at-least-once publishing without dual-writes",
                },
            ],
            known_constraints=[
                "Database connection pool limit during burst traffic",
                "Poison-pill payloads causing repeated consumer worker crashes",
            ],
            debugging_incidents=[
                {
                    "incident": "PostgreSQL connection pool exhaustion",
                    "resolution": "Configured connection pooling, reduced keepalive, and added batch commits",
                }
            ],
            # No user metrics or production deployment specified!
            metrics={},
            provenance=ProjectProvenance(
                source="user_portfolio",
                owner_id=OWNER_ID,
                is_editable=True,
            ),
        )

    def test_b20_ac1_missing_metrics_remain_unknown_never_invented(self):
        """
        B20-AC1: Missing users, deployment or impact data remains unknown rather than invented.
        """
        # Audit artifact without metrics
        audits = audit_project_metrics(self.raw_artifact)
        audit_by_name = {a.metric_name: a for a in audits}

        # 1. User count must be UNKNOWN, not invented
        self.assertIn("user_count", audit_by_name)
        self.assertEqual(audit_by_name["user_count"].status, MetricStatus.UNKNOWN)
        self.assertIsNone(audit_by_name["user_count"].raw_value)
        self.assertIn("unknown rather than invented", audit_by_name["user_count"].detail)

        # 2. Deployment environment must be UNKNOWN, not invented
        self.assertIn("deployment_environment", audit_by_name)
        self.assertEqual(audit_by_name["deployment_environment"].status, MetricStatus.UNKNOWN)
        self.assertIsNone(audit_by_name["deployment_environment"].raw_value)
        self.assertIn("unknown rather than invented", audit_by_name["deployment_environment"].detail)

        # 3. Quantitative impact must be UNKNOWN, not invented
        self.assertIn("quantitative_impact", audit_by_name)
        self.assertEqual(audit_by_name["quantitative_impact"].status, MetricStatus.UNKNOWN)
        self.assertIsNone(audit_by_name["quantitative_impact"].raw_value)
        self.assertIn("unknown rather than invented", audit_by_name["quantitative_impact"].detail)

        # 4. Starting a session records specific gaps for unknown metrics
        state = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
        )
        gap_keys = [g.gap_key for g in state.specific_gaps]
        self.assertIn("missing_user_count", gap_keys)
        self.assertIn("missing_deployment_environment", gap_keys)
        self.assertIn("missing_quantitative_impact", gap_keys)

    def test_b20_ac2_followup_references_artifact_and_preserves_source_ids(self):
        """
        B20-AC2: A follow-up references an actual artifact/answer and preserves source IDs.
        """
        state = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
        )

        initial_turn = state.turns[0]
        self.assertEqual(initial_turn.role, "interviewer")
        self.assertEqual(initial_turn.target_artifact_id, self.raw_artifact.id)
        self.assertIn("Event-Driven Distributed Pipeline", initial_turn.content)
        self.assertIn("Redis sliding TTL window", initial_turn.content)

        # Candidate submits answer explaining the debugging incident
        candidate_text = (
            "In staging, our PostgreSQL connection pool exhausted at 50 connections "
            "because each worker held open a persistent connection during HTTP API calls."
        )
        interviewer_turn = execute_project_review_turn(
            state=state,
            candidate_input=candidate_text,
            source_turn_id=initial_turn.id,
            target_artifact_id=self.raw_artifact.id,
        )

        # Verify source IDs are preserved
        cand_turn = state.turns[-2]
        self.assertEqual(cand_turn.role, "candidate")
        self.assertEqual(cand_turn.source_turn_id, initial_turn.id)
        self.assertEqual(cand_turn.target_artifact_id, self.raw_artifact.id)

        self.assertEqual(interviewer_turn.role, "interviewer")
        self.assertEqual(interviewer_turn.source_turn_id, cand_turn.id)
        self.assertEqual(interviewer_turn.target_artifact_id, self.raw_artifact.id)

        # Verify interviewer's response quotes/references candidate's actual answer
        self.assertIn("In staging, our PostgreSQL connection pool exhausted", interviewer_turn.content)
        self.assertIn("connection pool", interviewer_turn.content.lower())
        self.assertEqual(interviewer_turn.stage, "debugging")

    def test_b20_ac3_project_evidence_does_not_change_algorithm_readiness(self):
        """
        B20-AC3: Project/behavioural evidence does not change algorithm readiness automatically.
        """
        state = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
        )

        # Submit answer and evaluate rubrics
        candidate_text = (
            "We observed 500 errors in our staging logs when concurrent requests hit 2,000. "
            "We isolated the bottleneck using pprof and database connection pool metrics."
        )
        execute_project_review_turn(
            state=state,
            candidate_input=candidate_text,
            source_turn_id=state.turns[0].id,
            target_artifact_id=self.raw_artifact.id,
        )

        scores, observations = evaluate_project_rubrics_and_observations(state)
        self.assertGreater(scores["architecture_tradeoffs"], 0.70)
        self.assertGreater(scores["debugging_depth"], 0.70)

        # Observations must be emitted for project & behavioral dimensions
        obs_keys = [o.competency_key for o in observations]
        self.assertIn("project.architecture.concurrency_tradeoffs", obs_keys)
        self.assertIn("project.debugging.root_cause_isolation", obs_keys)
        self.assertIn("behavioral.star.incident_response", obs_keys)

        # Verify algorithm readiness isolation
        iso_result = verify_algorithm_readiness_isolation(
            observations=observations,
            dsa_competency_key="two_sum_hash_map",
        )
        self.assertTrue(iso_result["isolated"])
        self.assertFalse(iso_result["dsa_readiness_unlocked"])
        self.assertNotIn("two_sum_hash_map", iso_result["verified_project_keys"])

    def test_b20_failure_to_prevent_official_interview_disclaimer(self):
        """
        Failure to prevent: Role-specific practice is not an official company interview
        unless supported by attributable current requirements.
        """
        # 1. Unattributed practice session
        state_unattributed = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
            official_job_req_id=None,
        )
        self.assertFalse(state_unattributed.is_official_company_interview)
        self.assertIn(
            "Role-specific practice is not an official company interview",
            state_unattributed.disclaimer,
        )

        # 2. Attributed practice session with valid req ID
        state_attributed = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
            official_job_req_id="REQ-VERIFIED-META-PE-01",
        )
        self.assertTrue(state_attributed.is_official_company_interview)
        self.assertIn("REQ-VERIFIED-META-PE-01", state_attributed.disclaimer)

    def test_b20_route_gaps_to_study_activities(self):
        """
        Routes observed project gaps to actionable curriculum study activities.
        """
        state = create_project_review_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            artifact=self.raw_artifact,
        )
        state.specific_gaps.append(
            ProjectGap(
                gap_key="missing_deployment_telemetry",
                dimension="operational_telemetry",
                description="Missing production APM metrics.",
                resolved=False,
            )
        )
        state.specific_gaps.append(
            ProjectGap(
                gap_key="concurrency_lock_contention",
                dimension="concurrency_constraints",
                description="Unable to explain deadlock prevention.",
                resolved=False,
            )
        )

        recommendations = route_gaps_to_study_activities(state)
        rec_by_gap = {r.gap_key: r for r in recommendations}

        self.assertIn("missing_deployment_telemetry", rec_by_gap)
        self.assertEqual(rec_by_gap["missing_deployment_telemetry"].activity_id, "act_cs_distributed_telemetry")
        self.assertEqual(rec_by_gap["missing_deployment_telemetry"].track, "cs")

        self.assertIn("concurrency_lock_contention", rec_by_gap)
        self.assertEqual(rec_by_gap["concurrency_lock_contention"].activity_id, "act_cs_concurrency_locks")
        self.assertEqual(rec_by_gap["concurrency_lock_contention"].track, "cs")


if __name__ == "__main__":
    unittest.main()
