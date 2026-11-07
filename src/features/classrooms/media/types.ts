/**
 * Sprint B27: Media & Voice Boundaries Types
 * Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md
 */

export interface SourceCitation {
  source_id: string;
  snippet: string;
  verified: boolean;
  url_or_path?: string;
  page_or_section?: string;
}

export interface SourceResultContract {
  connector_id: string;
  connector_version: string;
  source_uri: string;
  title: string;
  content: string;
  citations: SourceCitation[];
  fetched_at: string;
  citations_verified: boolean;
  fallback_used: boolean;
  metadata: Record<string, any>;
}

export interface TranscriptProvenance {
  provenance_id: string;
  original_text: string;
  amended_text: string;
  user_edited: boolean;
  edit_reason: string;
  accent_or_stt_artifact: boolean;
  timestamp: string;
}

export interface VoiceTranscriptRecord {
  id: string;
  owner_id: string;
  session_id: string;
  audio_snippet_id?: string;
  raw_transcript: string; // Immutable initial transcription (B27-AC2)
  effective_transcript: string; // Active text used for evaluation
  confidence: number;
  detected_language: string;
  provenance_history: TranscriptProvenance[];
  created_at: string;
  updated_at: string;
}

export interface ConnectorStatus {
  connector_id: string;
  version: string;
  available: boolean;
  enabled: boolean;
  status: 'available' | 'unavailable';
  notes: string;
}

export interface MediaStatusReport {
  connectors: Record<string, ConnectorStatus>;
  voice_recognition: {
    available: boolean;
    enabled: boolean;
    status: 'available' | 'unavailable';
    provider: string;
    notice: string;
  };
  policy: string;
}
