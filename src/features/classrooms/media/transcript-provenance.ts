/**
 * Sprint B27: Transcript Provenance & Source Fallback Utilities
 * Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md
 *
 * Enforces:
 * - B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
 * - B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
 * - B27-AC3: Without access the feature is unavailable, never reported integrated.
 */

import {
  VoiceTranscriptRecord,
  TranscriptProvenance,
  SourceResultContract,
  ConnectorStatus,
} from "./types";

export function createVoiceTranscript(
  ownerId: string,
  sessionId: string,
  rawTranscript: string,
  confidence: number = 1.0,
  audioSnippetId?: string
): VoiceTranscriptRecord {
  const now = new Date().toISOString();
  return {
    id: `tr_${Math.random().toString(36).substring(2, 11)}`,
    owner_id: ownerId,
    session_id: sessionId,
    audio_snippet_id: audioSnippetId,
    raw_transcript: rawTranscript,
    effective_transcript: rawTranscript,
    confidence,
    detected_language: "en",
    provenance_history: [],
    created_at: now,
    updated_at: now,
  };
}

export function amendVoiceTranscript(
  record: VoiceTranscriptRecord,
  amendedText: string,
  editReason: string = "Correction of speech-to-text transcription / accent misinterpretation",
  accentOrSTTArtifact: boolean = true
): VoiceTranscriptRecord {
  const now = new Date().toISOString();
  const provenanceEntry: TranscriptProvenance = {
    provenance_id: `prov_${Math.random().toString(36).substring(2, 10)}`,
    original_text: record.effective_transcript,
    amended_text: amendedText,
    user_edited: true,
    edit_reason: editReason,
    accent_or_stt_artifact: accentOrSTTArtifact,
    timestamp: now,
  };

  return {
    ...record,
    // B27-AC2: raw_transcript remains immutably preserved
    raw_transcript: record.raw_transcript,
    effective_transcript: amendedText,
    provenance_history: [...record.provenance_history, provenanceEntry],
    updated_at: now,
  };
}

export function verifySourceCitations(source: SourceResultContract): boolean {
  if (!source.citations || source.citations.length === 0) {
    return false;
  }
  return source.citations.every(
    (cit) => cit.snippet && source.content.includes(cit.snippet)
  );
}

export function resolveSourceWithFallback(
  primarySource: SourceResultContract | null,
  localFallback: SourceResultContract
): SourceResultContract {
  // B27-AC1: If primary source is null or fails citation verification, fall back to local reference
  if (!primarySource || !verifySourceCitations(primarySource)) {
    return {
      ...localFallback,
      fallback_used: true,
      metadata: {
        ...localFallback.metadata,
        fallback_reason: !primarySource
          ? "Primary connector unavailable"
          : "Primary connector citations failed verification",
      },
    };
  }
  return primarySource;
}

export function isConnectorConfigured(status?: ConnectorStatus): boolean {
  // B27-AC3: Without access the feature is unavailable, never reported integrated
  return Boolean(status && status.available && status.enabled);
}
