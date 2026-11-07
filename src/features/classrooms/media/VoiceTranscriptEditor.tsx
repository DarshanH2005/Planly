"use client";

/**
 * Sprint B27: Voice Transcript Editor & Provenance Tracker
 * Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md
 *
 * Enforces:
 * - B27-AC2: Edited transcripts preserve provenance and do not silently overwrite recorded reasoning.
 * - B27-AC3: Without access the feature is unavailable, never reported integrated.
 * - Assess explanation content without treating accent/transcription errors as skill evidence.
 */

import React, { useState } from "react";
import { Mic, MicOff, Edit3, History, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceTranscriptRecord, TranscriptProvenance } from "./types";

interface VoiceTranscriptEditorProps {
  transcript: VoiceTranscriptRecord;
  voiceAvailable?: boolean;
  onAmend: (amendedText: string, editReason: string, isAccentOrSTT: boolean) => Promise<void>;
  disabled?: boolean;
}

export function VoiceTranscriptEditor({
  transcript,
  voiceAvailable = false,
  onAmend,
  disabled = false,
}: VoiceTranscriptEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(transcript.effective_transcript);
  const [editReason, setEditReason] = useState(
    "Correction of speech-to-text transcription / accent misinterpretation"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleSaveAmendment = async () => {
    if (!editText.trim()) return;
    setIsSaving(true);
    try {
      await onAmend(editText.trim(), editReason.trim(), true);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="voice-transcript-editor">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {voiceAvailable ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
              <Mic className="h-3 w-3" /> Voice Input Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              <MicOff className="h-3 w-3" /> Voice STT Unavailable (Text Active)
            </span>
          )}

          {transcript.provenance_history.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full">
              <History className="h-3 w-3" /> Edited ({transcript.provenance_history.length} revision{transcript.provenance_history.length > 1 ? "s" : ""})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {transcript.provenance_history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs h-7 px-2"
            >
              {showHistory ? "Hide Provenance" : "View Provenance"}
            </Button>
          )}

          {!isEditing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditText(transcript.effective_transcript);
                setIsEditing(true);
              }}
              disabled={disabled}
              className="text-xs h-7 gap-1"
            >
              <Edit3 className="h-3 w-3" /> Amend Transcript
            </Button>
          )}
        </div>
      </div>

      {/* Editing Form */}
      {isEditing ? (
        <div className="space-y-3 rounded-md bg-muted/40 p-3 border border-border/80">
          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Corrected Explanation (Conceptual Text)
            </label>
            <textarea
              className="w-full min-h-[90px] p-2 text-sm rounded border border-input bg-background font-sans focus:outline-none focus:ring-1 focus:ring-ring"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Correct any mis-transcribed words or speech-to-text artifacts..."
              disabled={isSaving}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">
              Amendment Reason / Provenance Rationale
            </label>
            <input
              type="text"
              className="w-full p-2 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. STT transcribed 'two pointers' as 'dire straits'"
              disabled={isSaving}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Original speech reasoning is preserved immutably.
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
                className="text-xs h-7"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveAmendment}
                disabled={isSaving || !editText.trim()}
                className="text-xs h-7"
              >
                {isSaving ? "Saving..." : "Save Amendment"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* Effective Transcript Display */
        <div className="rounded-md bg-muted/30 p-3 border border-border/60">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {transcript.effective_transcript}
          </p>
        </div>
      )}

      {/* Provenance History Timeline (B27-AC2) */}
      {showHistory && transcript.provenance_history.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/60 text-xs">
          <h4 className="font-semibold text-muted-foreground flex items-center gap-1">
            <History className="h-3.5 w-3.5" /> Provenance & Revision Audit Trail
          </h4>

          <div className="rounded bg-muted/20 p-2 border border-border/40 space-y-1">
            <span className="font-medium text-[11px] text-muted-foreground">Original Raw Transcription:</span>
            <p className="text-xs text-foreground italic bg-background/50 p-1.5 rounded">
              &ldquo;{transcript.raw_transcript}&rdquo;
            </p>
          </div>

          {transcript.provenance_history.map((prov, index) => (
            <div key={prov.provenance_id} className="p-2 rounded bg-muted/20 border border-border/40 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-medium">Amendment #{index + 1}</span>
                <span>{new Date(prov.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-foreground font-medium">&ldquo;{prov.amended_text}&rdquo;</p>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium">Reason:</span> {prov.edit_reason}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Fairness & Evaluation Notice */}
      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 p-2 rounded border border-border/40">
        <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          <strong>Fairness Policy:</strong> Speech recognition errors, disfluencies, or accent variations are never scored as technical deficits. Your technical reasoning is evaluated on conceptual invariants.
        </span>
      </div>
    </div>
  );
}
