"""
Sprint B23: Populated Backup and Verified Restore Integration Tests
Authority: PLANLY_BUILD_SPEC.md §12, §15; B23_backup_restore.md

Tests:
- B23-AC1: Populate, back up, restore into a disposable environment and resume exact pending artifact/question.
- B23-AC2: Missing/corrupt object bytes prevent a false successful restore.
- B23-AC3: Restoring older data cannot silently undo an applicable deletion or reclassify assisted work.
- Failure to Prevent: Exporting a separate empty backup store does not back up the application.
"""

import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from learning.api.auth import AuthenticatedOwner
from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    SessionStage,
    SessionMode,
    PendingTaskType,
    PendingTaskStatus,
)
from learning.repositories import evidence, sources, corrections
from learning.api.exports import (
    generate_backup_envelope,
    validate_backup_payload,
    restore_backup_payload,
    export_backup_endpoint,
    validate_backup_endpoint,
    restore_backup_endpoint,
    compute_payload_checksum,
    BackupExportRequest,
    BackupValidationRequest,
    BackupRestoreRequest,
)
from scripts.backup import run_backup
from scripts.restore import run_restore


class TestBackupRestoreLifecycle(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        sources.reset_sources_store()
        corrections.reset_corrections_store()
        self.owner_id = "test_learner_b23"

    def populate_learner_workspace(self, owner_id: str):
        # 1. Create classroom & session
        cls = evidence.create_classroom(owner_id, "dsa", "Two Pointers Masterclass")
        sess = evidence.create_session(owner_id, cls.id, stage=SessionStage.FOUNDATION, mode=SessionMode.PRACTICE)

        # 2. Record artifact revisions
        art1 = evidence.save_artifact(
            owner_id=owner_id,
            session_id=sess.id,
            expected_revision=1,
            content="def two_sum_brute(arr, target):\n    pass\n",
            language="python",
        )
        art2 = evidence.save_artifact(
            owner_id=owner_id,
            session_id=sess.id,
            expected_revision=2,
            content="def two_sum_hash(arr, target):\n    seen = {}\n    for i, x in enumerate(arr):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n",
            language="python",
        )

        # 3. Record session chat message
        msg = evidence.record_session_message(
            owner_id=owner_id,
            session_id=sess.id,
            sender_role="learner",
            content="I have implemented the hash map version, what about two pointers?",
            artifact_revision_snapshot=2,
        )

        # 4. Record pending task / question
        task, _ = sources.create_or_update_pending_task(
            owner_id=owner_id,
            classroom_id=cls.id,
            session_id=sess.id,
            task_type=PendingTaskType.PENDING_QUESTION,
            title="Two Pointers Variation",
            prompt_text="Can you adapt this for a sorted array using two pointers in O(1) extra space?",
        )

        # 5. Record attempt & observations
        att = evidence.record_attempt(
            owner_id=owner_id,
            session_id=sess.id,
            artifact_id=art2.id,
            frozen_code=art2.content,
            frozen_language="python",
            source_revision=2,
            assistance_level=AssistanceLevel.INDEPENDENT,
            mode=SessionMode.PRACTICE,
            elapsed_seconds=120,
        )

        obs1 = evidence.record_observation(
            owner_id=owner_id,
            session_id=sess.id,
            competency_key="dsa.arrays.two_sum",
            source_kind=SourceKind.EXECUTION_EVIDENCE,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Solved Two Sum with hash map independently",
            attempt_id=att.id,
            artifact_id=art2.id,
        )

        obs_guided = evidence.record_observation(
            owner_id=owner_id,
            session_id=sess.id,
            competency_key="dsa.two_pointers.sorted",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Required prompt for two pointers boundary",
        )

        sess = evidence.get_session(owner_id, sess.id) or sess
        return {
            "classroom": cls,
            "session": sess,
            "artifact_rev2": art2,
            "pending_task": task,
            "obs_independent": obs1,
            "obs_guided": obs_guided,
        }

    def test_b23_ac1_populate_backup_restore_and_resume_pending_state(self):
        # 1. Populate source learner workspace
        seed = self.populate_learner_workspace(self.owner_id)

        # 2. Export populated backup envelope
        envelope = generate_backup_envelope(self.owner_id)
        self.assertEqual(envelope.manifest.schema_version, "2.0.0")
        self.assertGreater(len(envelope.manifest.object_manifest), 0)
        self.assertIn("classrooms", envelope.data)

        # 3. Clear workspace (simulate clean/disposable target environment)
        evidence.reset_evidence_store()
        sources.reset_sources_store()
        corrections.reset_corrections_store()

        target_owner = "disposable_learner_target"

        # 4. Restore backup into disposable environment
        restore_res = restore_backup_payload(
            payload=envelope.model_dump(),
            target_owner_id=target_owner,
            target_environment="disposable",
        )

        self.assertTrue(restore_res.success)
        self.assertEqual(restore_res.target_owner_id, target_owner)
        self.assertEqual(restore_res.target_environment, "disposable")
        self.assertEqual(restore_res.resumable_session_id, seed["session"].id)
        self.assertEqual(
            restore_res.pending_question,
            "Can you adapt this for a sorted array using two pointers in O(1) extra space?",
        )
        self.assertEqual(restore_res.pending_artifact_revision, 2)

        # Verify resumed entities exist in repository for target owner
        resumed_sess = evidence.get_session(target_owner, seed["session"].id)
        self.assertIsNotNone(resumed_sess)
        self.assertEqual(resumed_sess.current_revision, seed["session"].current_revision)

        artifacts = evidence.get_session_artifacts(seed["session"].id)
        self.assertEqual(len(artifacts), 2)
        latest_art = [a for a in artifacts if a.revision == 2][0]
        self.assertIn("two_sum_hash", latest_art.content)

        tasks = sources.get_pending_tasks(target_owner)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].status, PendingTaskStatus.PENDING)

    def test_b23_ac2_missing_or_corrupt_object_bytes_prevent_restore(self):
        # 1. Populate workspace & export
        self.populate_learner_workspace(self.owner_id)
        envelope = generate_backup_envelope(self.owner_id)
        payload_dict = envelope.model_dump()

        # Find first artifact object in manifest
        first_art_id = list(payload_dict["manifest"]["object_manifest"].keys())[0]

        # Case A: Corrupted bytes (SHA-256 hash mismatch)
        corrupt_payload = json.loads(json.dumps(payload_dict))
        corrupt_payload["manifest"]["object_manifest"][first_art_id]["content_b64"] = (
            "Y29ycnVwdGVkLWJ5dGVz"  # base64 for "corrupted-bytes"
        )

        is_valid, err, _ = validate_backup_payload(corrupt_payload)
        self.assertFalse(is_valid)
        self.assertIn("B23-AC2", err)

        with self.assertRaises(ValueError) as ctx:
            restore_backup_payload(
                payload=corrupt_payload,
                target_owner_id="disposable_target",
                target_environment="disposable",
            )
        self.assertIn("B23-AC2", str(ctx.exception))

        # Case B: Missing object bytes
        missing_payload = json.loads(json.dumps(payload_dict))
        missing_payload["manifest"]["object_manifest"][first_art_id]["content_b64"] = ""

        is_valid, err, _ = validate_backup_payload(missing_payload)
        self.assertFalse(is_valid)
        self.assertIn("Missing object bytes", err)

    def test_b23_ac3_restoring_older_data_cannot_undo_deletion_or_reclassify_assisted(self):
        seed = self.populate_learner_workspace(self.owner_id)
        envelope = generate_backup_envelope(self.owner_id)
        payload_dict = envelope.model_dump()

        target_owner = "learner_with_privacy_deletions"

        # 1. Set up an active tombstone in target environment for obs_independent
        tombstone = corrections.TombstoneRecord(
            id="tomb_01",
            owner_id=target_owner,
            target_id=seed["obs_independent"].id,
            target_type="observation",
            reason="GDPR Right to be Forgotten request",
            deleted_at="2026-09-12T10:00:00Z",
            restore_token="rst_token_123",
            is_restored=False,
        )
        corrections._tombstones[tombstone.id] = tombstone

        # Corrupt data to test reclassification attempt: set guided observation to demonstrated=True
        guided_obs_id = seed["obs_guided"].id
        for obs_item in payload_dict["data"]["observations"]:
            if obs_item["id"] == guided_obs_id:
                obs_item["demonstrated"] = True  # Attempt invalid reclassification
        payload_dict["manifest"]["checksum"] = compute_payload_checksum(payload_dict["data"])

        # 2. Restore backup
        restore_res = restore_backup_payload(
            payload=payload_dict,
            target_owner_id=target_owner,
            target_environment="disposable",
            active_tombstones=[tombstone],
        )

        self.assertTrue(restore_res.success)
        self.assertEqual(restore_res.tombstones_reconciled, 1)

        # Verify obs_independent was pruned and NOT restored
        all_target_obs = evidence.get_owner_observations(target_owner)
        restored_ids = [o.id for o in all_target_obs]
        self.assertNotIn(seed["obs_independent"].id, restored_ids)

        # Verify guided observation was forced to demonstrated=False (no reclassification)
        guided_restored = [o for o in all_target_obs if o.id == guided_obs_id][0]
        self.assertFalse(guided_restored.demonstrated)

    def test_b23_failure_to_prevent_empty_backup_store_rejected(self):
        # Empty workspace
        with self.assertRaises(ValueError) as ctx:
            generate_backup_envelope("empty_user_id")
        self.assertIn("empty backup store", str(ctx.exception))

    def test_b23_cli_scripts_backup_and_restore(self):
        # 1. Populate workspace
        self.populate_learner_workspace(self.owner_id)

        with tempfile.TemporaryDirectory() as tmpdir:
            backup_file = os.path.join(tmpdir, "test_backup.json")

            # 2. Run backup CLI
            backup_code = run_backup(self.owner_id, backup_file, encrypt=True)
            self.assertEqual(backup_code, 0)
            self.assertTrue(os.path.exists(backup_file))

            # 3. Clear workspace & run restore CLI
            evidence.reset_evidence_store()
            sources.reset_sources_store()
            corrections.reset_corrections_store()

            restore_code = run_restore(
                input_path=backup_file,
                target_owner_id="cli_disposable_user",
                target_env="disposable",
            )
            self.assertEqual(restore_code, 0)

            # Confirm restored state in evidence repository
            classrooms = evidence.list_classrooms("cli_disposable_user")
            self.assertEqual(len(classrooms), 1)

    def test_b23_fastapi_endpoints(self):
        self.populate_learner_workspace(self.owner_id)
        owner = AuthenticatedOwner(owner_id=self.owner_id, email="learner@planly.dev")

        # 1. POST /api/exports/backup
        req_backup = BackupExportRequest(owner_id=self.owner_id)
        envelope = asyncio.run(export_backup_endpoint(req=req_backup, owner=owner))
        self.assertEqual(envelope.manifest.schema_version, "2.0.0")
        backup_data = envelope.model_dump()

        # 2. POST /api/exports/validate
        req_val = BackupValidationRequest(payload=backup_data, target_owner_id=self.owner_id)
        val_res = asyncio.run(validate_backup_endpoint(req=req_val, owner=owner))
        self.assertTrue(val_res["valid"])

        # 3. POST /api/exports/restore
        evidence.reset_evidence_store()
        sources.reset_sources_store()

        req_restore = BackupRestoreRequest(
            payload=backup_data,
            target_owner_id="restored_via_api",
            target_environment="disposable",
        )
        restore_res = asyncio.run(restore_backup_endpoint(req=req_restore, owner=owner))
        self.assertTrue(restore_res.success)
        self.assertEqual(restore_res.pending_artifact_revision, 2)


if __name__ == "__main__":
    unittest.main()
