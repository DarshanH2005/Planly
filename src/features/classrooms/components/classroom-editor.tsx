"use client";

/**
 * Classroom Code Editor Component.
 * Sprint: B09
 * Authority: planly_architecture.md sections 8, 13
 *
 * Implements:
 * 1. CodeMirror / textarea core with VS Code style chrome.
 * 2. Explicit revision parity tracking between UI and backend (B09-AC2).
 * 3. 409 Stale revision conflict handling with draft preservation.
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { FileCode2, Lock, PencilLine, Save, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClassroomEditorProps {
  value: string;
  language?: string;
  savedRevision: number;
  isDirty: boolean;
  isSaving: boolean;
  conflictRevision?: number | null;
  onChange: (val: string) => void;
  onSave: () => void;
  onResolveConflict?: (keepLocal: boolean) => void;
  disabled?: boolean;
}

export function ClassroomEditor({
  value,
  language = "python",
  savedRevision,
  isDirty,
  isSaving,
  conflictRevision,
  onChange,
  onSave,
  onResolveConflict,
  disabled = false,
}: ClassroomEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = value.substring(0, start) + "    " + value.substring(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = start + 4;
          textarea.selectionEnd = start + 4;
        });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !isSaving) {
          onSave();
        }
      }
    },
    [value, onChange, isDirty, isSaving, onSave]
  );

  const lines = value === "" ? 1 : value.split("\n").length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-[#131311] shadow-sm">
      {/* Editor Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#1A1A18] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <FileCode2 className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs font-semibold text-zinc-200">solution.py</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Revision and Dirty Status Badge (B09-AC2) */}
          <span
            data-testid="revision-badge"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-mono font-medium ${
              conflictRevision
                ? "bg-amber-500/20 text-amber-300"
                : isDirty
                ? "bg-primary/20 text-primary"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {conflictRevision ? (
              <>
                <AlertCircle className="h-3 w-3 text-amber-400" />
                <span>Rev Conflict (Server: {conflictRevision})</span>
              </>
            ) : isDirty ? (
              <>
                <PencilLine className="h-3 w-3 text-primary" />
                <span>Rev {savedRevision} · Unsaved Draft</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                <span>Rev {savedRevision} · Saved</span>
              </>
            )}
          </span>

          {/* Save Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={!isDirty || isSaving || disabled}
            data-testid="save-artifact-button"
            className="h-7 gap-1.5 border-white/20 bg-white/5 px-2.5 text-xs text-white hover:bg-white/10 disabled:opacity-40"
          >
            {isSaving ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            <span>{isSaving ? "Saving..." : "Save Code"}</span>
          </Button>
        </div>
      </div>

      {/* Conflict Warning Banner if 409 occurs */}
      {conflictRevision && (
        <div
          data-testid="conflict-banner"
          className="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Server has a newer revision (Rev {conflictRevision}). Your draft is preserved locally.
            </span>
          </div>
          {onResolveConflict && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onResolveConflict(true)}
                className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30"
              >
                Overwrite Server (Rev {conflictRevision})
              </button>
              <button
                onClick={() => onResolveConflict(false)}
                className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-300 hover:bg-white/20"
              >
                Load Server Code
              </button>
            </div>
          )}
        </div>
      )}

      {/* Code Textarea Area */}
      <div className="relative flex-1 min-h-[360px] bg-[#131311]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="DSA Code Solution"
          data-testid="code-editor-textarea"
          className="h-full w-full resize-none border-none bg-transparent p-4 font-mono text-[13.5px] leading-[1.7] text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-60"
          placeholder="# Write your Python solution here...&#10;def two_sum(numbers: list[int], target: int) -> list[int]:&#10;    # Implement inward convergence invariant&#10;    left, right = 0, len(numbers) - 1&#10;    while left < right:&#10;        ...&#10;"
        />
      </div>

      {/* Editor Status Bar */}
      <div className="flex items-center justify-between border-t border-white/10 bg-[#1A1A18] px-4 py-1.5 text-[11px] font-medium text-zinc-400">
        <span className="flex items-center gap-2">
          <span>Python 3 · UTF-8</span>
          <span className="hidden sm:inline">· Tab = 4 spaces</span>
        </span>
        <span className="font-mono tabular-nums">
          {lines} {lines === 1 ? "line" : "lines"} · {value.length} chars
        </span>
      </div>
    </div>
  );
}
