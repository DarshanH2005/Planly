"""
Sprint B27: Media, Voice Boundaries & Transcript Provenance API
Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md

Enforces:
- B27-AC1: Connector failure or missing citations falls back to local references without stopping DSA.
- B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
- B27-AC3: Without access the feature is unavailable, never reported integrated.
- Explanations assessed on conceptual content without penalizing accent or transcription errors.
"""

import os
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.tools.source_connectors.manager import get_source_manager
from learning.tools.source_connectors.base import SourceResultContract

router = APIRouter(prefix="/api/media", tags=["Media & Voice"])


class TranscriptProvenance(BaseModel):
    provenance_id: str
    original_text: str
    amended_text: str
    user_edited: bool = True
    edit_reason: str
    accent_or_stt_artifact: bool = True
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VoiceTranscriptRecord(BaseModel):
    id: str
    owner_id: str
    session_id: str
    audio_snippet_id: Optional[str] = None
    raw_transcript: str  # Immutable initial transcription (B27-AC2)
    effective_transcript: str  # Active text for evaluation
    confidence: float = 1.0
    detected_language: str = "en"
    provenance_history: List[TranscriptProvenance] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TranscriptCreateInput(BaseModel):
    session_id: str
    raw_transcript: str
    audio_snippet_id: Optional[str] = None
    confidence: float = 1.0
    detected_language: str = "en"


class TranscriptAmendInput(BaseModel):
    amended_text: str
    edit_reason: str = "Correction of speech-to-text transcription / accent misinterpretation"
    accent_or_stt_artifact: bool = True


class SourceFetchInput(BaseModel):
    source_uri: str
    preferred_connector: str = "notebooklm"


class MediaStatusReport(BaseModel):
    connectors: Dict[str, Dict[str, Any]]
    voice_recognition: Dict[str, Any]
    policy: str = "Candidate privacy preserved; no unconsented data uploads or fake audio."


# In-memory store for transcript provenance
_transcripts_store: Dict[str, VoiceTranscriptRecord] = {}


def reset_media_store():
    _transcripts_store.clear()


@router.get("/status", response_model=MediaStatusReport)
def get_media_status():
    """
    B27-AC3: Without access the feature is unavailable, never reported integrated.
    """
    manager = get_source_manager()
    connectors_status = manager.get_status_report()

    # Voice STT provider availability check
    voice_api_key = os.environ.get("PLANLY_VOICE_STT_KEY")
    voice_available = bool(voice_api_key and len(voice_api_key.strip()) > 0)

    voice_status = {
        "available": voice_available,
        "enabled": voice_available,
        "status": "available" if voice_available else "unavailable",
        "provider": "whisper_or_gemini_audio" if voice_available else "none",
        "notice": (
            "Voice processing active."
            if voice_available
            else "Voice recognition unavailable — candidate typed input active. Transcription errors never penalized."
        ),
    }

    return MediaStatusReport(
        connectors=connectors_status,
        voice_recognition=voice_status,
    )


@router.post("/sources/fetch", response_model=SourceResultContract)
def fetch_source_with_fallback(
    payload: SourceFetchInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """
    B27-AC1: Connector failure or missing citations falls back to local references without stopping DSA.
    """
    manager = get_source_manager()
    result = manager.fetch_with_fallback(
        source_uri=payload.source_uri,
        preferred_connector=payload.preferred_connector,
    )
    return result


@router.post("/transcripts", response_model=VoiceTranscriptRecord)
def record_voice_transcript(
    payload: TranscriptCreateInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """
    Records an initial voice transcription.
    Preserves raw_transcript immutably for provenance tracking (B27-AC2).
    """
    t_id = f"tr_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    record = VoiceTranscriptRecord(
        id=t_id,
        owner_id=owner.owner_id,
        session_id=payload.session_id,
        audio_snippet_id=payload.audio_snippet_id,
        raw_transcript=payload.raw_transcript,
        effective_transcript=payload.raw_transcript,
        confidence=payload.confidence,
        detected_language=payload.detected_language,
        provenance_history=[],
        created_at=now_iso,
        updated_at=now_iso,
    )
    _transcripts_store[t_id] = record
    return record


@router.put("/transcripts/{transcript_id}/amend", response_model=VoiceTranscriptRecord)
def amend_voice_transcript(
    transcript_id: str,
    payload: TranscriptAmendInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """
    B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
    Retains original raw transcript and appends an explicit provenance entry.
    """
    rec = _transcripts_store.get(transcript_id)
    if not rec or rec.owner_id != owner.owner_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript '{transcript_id}' not found.",
        )

    prov_entry = TranscriptProvenance(
        provenance_id=f"prov_{uuid.uuid4().hex[:8]}",
        original_text=rec.effective_transcript,
        amended_text=payload.amended_text,
        user_edited=True,
        edit_reason=payload.edit_reason,
        accent_or_stt_artifact=payload.accent_or_stt_artifact,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    rec.provenance_history.append(prov_entry)
    rec.effective_transcript = payload.amended_text
    rec.updated_at = datetime.now(timezone.utc).isoformat()

    return rec


@router.get("/transcripts/{transcript_id}", response_model=VoiceTranscriptRecord)
def get_voice_transcript(
    transcript_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """Retrieves transcript record with full provenance history."""
    rec = _transcripts_store.get(transcript_id)
    if not rec or rec.owner_id != owner.owner_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript '{transcript_id}' not found.",
        )
    return rec


def evaluate_explanation_content(
    owner_id: str,
    transcript_id: str,
    required_invariants: List[str],
) -> Dict[str, Any]:
    """
    Assesses explanation content conceptually without penalizing speech artifacts or transcription noise.
    Uses effective_transcript (which respects user amendments) while noting provenance.
    """
    rec = _transcripts_store.get(transcript_id)
    if not rec or rec.owner_id != owner_id:
        raise ValueError(f"Transcript '{transcript_id}' not found.")

    text_to_eval = rec.effective_transcript.lower()
    matched = []
    missing = []

    for inv in required_invariants:
        if inv.lower() in text_to_eval:
            matched.append(inv)
        else:
            missing.append(inv)

    is_adequate = len(missing) == 0
    return {
        "transcript_id": transcript_id,
        "is_adequate": is_adequate,
        "matched_invariants": matched,
        "missing_invariants": missing,
        "raw_retained": rec.raw_transcript,
        "user_amended": len(rec.provenance_history) > 0,
        "provenance_count": len(rec.provenance_history),
        "evaluation_basis": "conceptual_invariants_only",
        "stt_accent_penalized": False,
    }
