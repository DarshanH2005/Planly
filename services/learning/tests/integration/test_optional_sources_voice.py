"""
Sprint B27: Optional Source Connectors & Voice Boundaries Integration Tests
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Tests:
- B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
- B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
- B27-AC3: Without access the feature is unavailable, never reported integrated.
- Explanations assessed on conceptual invariants without penalizing accent or transcription noise.
- Failure to Prevent: Optional integrations are not release blockers; no unverified browser automation.
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
from learning.repositories import evidence
from learning.api.auth import AuthenticatedOwner
from learning.tools.source_connectors.base import (
    ConnectorUnavailableError,
    CitationVerificationError,
    SourceResultContract,
    SourceCitation,
)
from learning.tools.source_connectors.notebooklm import NotebookLMConnector
from learning.tools.source_connectors.local_fallback import LocalReferenceConnector
from learning.tools.source_connectors.manager import SourceConnectorManager, get_source_manager
from learning.api.media import (
    reset_media_store,
    evaluate_explanation_content,
    get_media_status,
    fetch_source_with_fallback,
    record_voice_transcript,
    amend_voice_transcript,
    get_voice_transcript,
    TranscriptCreateInput,
    TranscriptAmendInput,
    SourceFetchInput,
    VoiceTranscriptRecord,
)


class TestOptionalSourcesVoice(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        reset_media_store()
        self.owner_id = "test_learner_b27"
        self.owner = AuthenticatedOwner(owner_id=self.owner_id, email="learner@example.com")

        self.cls = evidence.create_classroom(self.owner_id, "dsa", "Algorithms Study")
        self.sess = evidence.create_session(
            self.owner_id, self.cls.id, stage=SessionStage.FOUNDATION, mode=SessionMode.PRACTICE
        )

    def test_b27_ac1_connector_failure_or_missing_citations_falls_back_to_local_references(self):
        """
        B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
        When an external source (NotebookLM) is unavailable, throws an error, or provides unverified citations,
        the manager seamlessly falls back to curated local references, ensuring the learner's DSA session continues.
        """
        manager = SourceConnectorManager()

        # 1. Preferred connector unavailable -> gracefully falls back to local reference
        result_unavail = manager.fetch_with_fallback(
            source_uri="two_pointers",
            preferred_connector="notebooklm",
        )
        self.assertTrue(result_unavail.fallback_used)
        self.assertEqual(result_unavail.connector_id, "local_reference")
        self.assertTrue(result_unavail.citations_verified)
        self.assertGreater(len(result_unavail.citations), 0)
        self.assertIn("converging pointers", result_unavail.content)

        # 2. Test connector that returns missing or invalid citations
        class MockFailingCitationConnector(NotebookLMConnector):
            def is_available(self) -> bool:
                return True

            def fetch_source(self, source_uri: str, **kwargs):
                # Returns a result where citation snippet is NOT in content
                return SourceResultContract(
                    connector_id="mock_unverified",
                    source_uri=source_uri,
                    title="Bogus Reference",
                    content="Real content without the cited claim.",
                    citations=[
                        SourceCitation(
                            source_id="bogus_cit",
                            snippet="Non-existent claim not found in content",
                            verified=False,
                        )
                    ],
                )

        manager.register_connector("mock_unverified", MockFailingCitationConnector())

        # Calling fetch_with_fallback with mock_unverified must fall back to local reference
        result_failed_cit = manager.fetch_with_fallback(
            source_uri="sliding_window",
            preferred_connector="mock_unverified",
        )
        self.assertTrue(result_failed_cit.fallback_used)
        self.assertEqual(result_failed_cit.connector_id, "local_reference")
        self.assertTrue(result_failed_cit.citations_verified)
        self.assertIn("Sliding Window Dynamic Subarray State", result_failed_cit.title)

        # 3. Via API endpoint: fetch with fallback returns valid reference
        api_res = fetch_source_with_fallback(
            payload=SourceFetchInput(source_uri="binary_search", preferred_connector="notebooklm"),
            owner=self.owner,
        )
        self.assertTrue(api_res.fallback_used)
        self.assertEqual(api_res.connector_id, "local_reference")
        self.assertTrue(api_res.citations_verified)
        self.assertIn("Binary Search", api_res.title)

    def test_b27_ac2_edited_transcripts_preserve_provenance_and_never_overwrite_reasoning(self):
        """
        B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
        The raw initial transcript is retained immutably. Candidate amendments append audit provenance
        entries with rationale and timestamp.
        """
        # 1. Record raw transcription (e.g. STT transcribed 'two pointers' with a typo)
        create_payload = TranscriptCreateInput(
            session_id=self.sess.id,
            raw_transcript="We use dire straits to converge from left and right boundaries until low meets high.",
            confidence=0.82,
            detected_language="en",
        )
        t_data = record_voice_transcript(payload=create_payload, owner=self.owner)
        transcript_id = t_data.id
        self.assertEqual(t_data.raw_transcript, create_payload.raw_transcript)
        self.assertEqual(t_data.effective_transcript, create_payload.raw_transcript)
        self.assertEqual(len(t_data.provenance_history), 0)

        # 2. Candidate amends the transcript to fix the STT misinterpretation
        amended_text = "We use two pointers to converge from left and right boundaries until low meets high."
        amend_payload = TranscriptAmendInput(
            amended_text=amended_text,
            edit_reason="Speech-to-text mistook 'two pointers' as 'dire straits' due to microphone noise",
            accent_or_stt_artifact=True,
        )
        amended_data = amend_voice_transcript(
            transcript_id=transcript_id,
            payload=amend_payload,
            owner=self.owner,
        )

        # Crucial B27-AC2 assertions:
        # Original raw reasoning is PRESERVED, not overwritten
        self.assertEqual(amended_data.raw_transcript, create_payload.raw_transcript)
        self.assertEqual(amended_data.effective_transcript, amended_text)
        self.assertEqual(len(amended_data.provenance_history), 1)
        prov = amended_data.provenance_history[0]
        self.assertEqual(prov.original_text, create_payload.raw_transcript)
        self.assertEqual(prov.amended_text, amended_text)
        self.assertEqual(prov.edit_reason, amend_payload.edit_reason)
        self.assertTrue(prov.user_edited)
        self.assertTrue(prov.accent_or_stt_artifact)

        # 3. Assess explanation content: conceptual evaluation succeeds without penalizing speech artifacts
        eval_result = evaluate_explanation_content(
            owner_id=self.owner_id,
            transcript_id=transcript_id,
            required_invariants=["two pointers", "left and right", "boundaries"],
        )
        self.assertTrue(eval_result["is_adequate"])
        self.assertEqual(eval_result["raw_retained"], create_payload.raw_transcript)
        self.assertTrue(eval_result["user_amended"])
        self.assertFalse(eval_result["stt_accent_penalized"])
        self.assertEqual(eval_result["evaluation_basis"], "conceptual_invariants_only")

    def test_b27_ac3_without_access_feature_is_unavailable_never_reported_integrated(self):
        """
        B27-AC3: Without access the feature is unavailable, never reported integrated.
        - NotebookLM connector without credentials reports is_available() == False.
        - Fetching directly raises ConnectorUnavailableError with clear explanation.
        - /api/media/status reports status='unavailable' for unconfigured integrations.
        - Community browser automation is explicitly rejected as trusted policy.
        """
        # 1. Direct connector check
        notebook_conn = NotebookLMConnector(api_key=None)
        self.assertFalse(notebook_conn.is_available())

        with self.assertRaises(ConnectorUnavailableError) as ctx:
            notebook_conn.fetch_source("any_uri")
        self.assertIn("unavailable: no authorized API credentials configured", str(ctx.exception))
        self.assertIn("Community browser automation is an untrusted external adapter", str(ctx.exception))
        self.assertIn("B27-AC3", str(ctx.exception))

        # 2. Manager status report
        manager = SourceConnectorManager()
        status_report = manager.get_status_report()
        self.assertIn("notebooklm", status_report)
        self.assertFalse(status_report["notebooklm"]["available"])
        self.assertFalse(status_report["notebooklm"]["enabled"])
        self.assertEqual(status_report["notebooklm"]["status"], "unavailable")

        # 3. Media status endpoint
        status_data = get_media_status()
        self.assertEqual(status_data.connectors["notebooklm"]["status"], "unavailable")
        self.assertFalse(status_data.connectors["notebooklm"]["available"])
        self.assertFalse(status_data.connectors["notebooklm"]["enabled"])

        # Voice recognition without STT key also reports unavailable
        self.assertEqual(status_data.voice_recognition["status"], "unavailable")
        self.assertFalse(status_data.voice_recognition["available"])
        self.assertFalse(status_data.voice_recognition["enabled"])


if __name__ == "__main__":
    unittest.main()
