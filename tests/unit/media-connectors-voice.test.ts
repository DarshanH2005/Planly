/**
 * Sprint B27: Media Connectors & Voice Boundaries Unit Tests
 * Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md
 *
 * Tests:
 * - B27-AC1: Connector failure/missing citations falls back to local references.
 * - B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
 * - B27-AC3: Without access the feature is unavailable, never reported integrated.
 */

import { describe, it, expect } from "vitest";
import {
  createVoiceTranscript,
  amendVoiceTranscript,
  verifySourceCitations,
  resolveSourceWithFallback,
  isConnectorConfigured,
} from "../../src/features/classrooms/media/transcript-provenance";
import {
  SourceResultContract,
  ConnectorStatus,
} from "../../src/features/classrooms/media/types";

describe("Sprint B27: Media & Voice Boundaries", () => {
  const sampleLocalFallback: SourceResultContract = {
    connector_id: "local_reference",
    connector_version: "1.0.0",
    source_uri: "two_pointers",
    title: "Two Pointers Core Invariants",
    content: "Converging pointers achieve O(N) time with O(1) auxiliary space.",
    citations: [
      {
        source_id: "cit_01",
        snippet: "Converging pointers achieve O(N) time with O(1) auxiliary space.",
        verified: true,
        url_or_path: "docs/curriculum/dsa/two_pointers.md",
      },
    ],
    fetched_at: new Date().toISOString(),
    citations_verified: true,
    fallback_used: false,
    metadata: { source_tier: "canonical_local" },
  };

  describe("B27-AC1: Source Connector Fallback & Citation Verification", () => {
    it("falls back to local reference when primary connector returns null (unavailable)", () => {
      const resolved = resolveSourceWithFallback(null, sampleLocalFallback);
      expect(resolved.fallback_used).toBe(true);
      expect(resolved.connector_id).toBe("local_reference");
      expect(resolved.title).toBe("Two Pointers Core Invariants");
      expect(resolved.metadata.fallback_reason).toBe("Primary connector unavailable");
    });

    it("falls back to local reference when primary connector citations fail verification", () => {
      const invalidCitationSource: SourceResultContract = {
        connector_id: "notebooklm",
        connector_version: "0.1.0",
        source_uri: "sliding_window",
        title: "Sliding Window Notes",
        content: "Dynamic window expands right and contracts left.",
        citations: [
          {
            source_id: "bogus_cit",
            snippet: "This quoted string is completely missing from the content.",
            verified: false,
          },
        ],
        fetched_at: new Date().toISOString(),
        citations_verified: false,
        fallback_used: false,
        metadata: {},
      };

      expect(verifySourceCitations(invalidCitationSource)).toBe(false);

      const resolved = resolveSourceWithFallback(invalidCitationSource, sampleLocalFallback);
      expect(resolved.fallback_used).toBe(true);
      expect(resolved.connector_id).toBe("local_reference");
      expect(resolved.metadata.fallback_reason).toBe("Primary connector citations failed verification");
    });

    it("verifies grounded citations correctly", () => {
      expect(verifySourceCitations(sampleLocalFallback)).toBe(true);
    });
  });

  describe("B27-AC2: Transcript Provenance & Immutable Reasoning Retention", () => {
    it("creates transcript with immutable raw_transcript", () => {
      const rawText = "We use dire straits to converge from boundaries.";
      const transcript = createVoiceTranscript("learner_b27", "sess_b27_01", rawText, 0.85);

      expect(transcript.raw_transcript).toBe(rawText);
      expect(transcript.effective_transcript).toBe(rawText);
      expect(transcript.provenance_history).toHaveLength(0);
    });

    it("amends transcript while preserving original raw reasoning and logging provenance audit trail", () => {
      const rawText = "We use dire straits to converge from boundaries.";
      const transcript = createVoiceTranscript("learner_b27", "sess_b27_01", rawText, 0.85);

      const amendedText = "We use two pointers to converge from boundaries.";
      const editReason = "Speech-to-text mistook 'two pointers' as 'dire straits' due to microphone noise";

      const updated = amendVoiceTranscript(transcript, amendedText, editReason, true);

      // Crucial B27-AC2 assertions:
      // 1. raw_transcript is NOT overwritten
      expect(updated.raw_transcript).toBe(rawText);
      // 2. effective_transcript reflects user correction
      expect(updated.effective_transcript).toBe(amendedText);
      // 3. provenance entry is logged with reason and timestamp
      expect(updated.provenance_history).toHaveLength(1);
      const prov = updated.provenance_history[0];
      expect(prov.original_text).toBe(rawText);
      expect(prov.amended_text).toBe(amendedText);
      expect(prov.edit_reason).toBe(editReason);
      expect(prov.accent_or_stt_artifact).toBe(true);
      expect(prov.user_edited).toBe(true);
      expect(prov.timestamp).toBeDefined();
    });

    it("supports multiple sequential amendments without losing original raw transcription", () => {
      const rawText = "Binary search splits space.";
      let transcript = createVoiceTranscript("learner_b27", "sess_b27_02", rawText);

      transcript = amendVoiceTranscript(transcript, "Binary search halves the search space.", "Added clarity");
      transcript = amendVoiceTranscript(
        transcript,
        "Binary search halves the search space in logarithmic time O(log N).",
        "Added complexity invariant"
      );

      expect(transcript.raw_transcript).toBe(rawText);
      expect(transcript.effective_transcript).toBe(
        "Binary search halves the search space in logarithmic time O(log N)."
      );
      expect(transcript.provenance_history).toHaveLength(2);
      expect(transcript.provenance_history[0].original_text).toBe(rawText);
      expect(transcript.provenance_history[1].original_text).toBe("Binary search halves the search space.");
    });
  });

  describe("B27-AC3: Connector Configuration & Availability Guard", () => {
    it("reports connector as unconfigured when available or enabled is false", () => {
      const unavailableStatus: ConnectorStatus = {
        connector_id: "notebooklm",
        version: "0.1.0",
        available: false,
        enabled: false,
        status: "unavailable",
        notes: "Requires authorized API credentials",
      };

      expect(isConnectorConfigured(unavailableStatus)).toBe(false);
      expect(isConnectorConfigured(undefined)).toBe(false);
    });

    it("reports connector as configured only when both available and enabled are true", () => {
      const availableStatus: ConnectorStatus = {
        connector_id: "local_reference",
        version: "1.0.0",
        available: true,
        enabled: true,
        status: "available",
        notes: "Curated local references",
      };

      expect(isConnectorConfigured(availableStatus)).toBe(true);
    });
  });
});
