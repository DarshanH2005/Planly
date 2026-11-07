"use client";

/**
 * Code editor — textarea core with VS-Code-like chrome.
 * (CodeMirror lazy upgrade path preserved; no behavior change.)
 */

import { useEffect, useRef, useCallback } from "react";
import { FileCode2, Lock, PencilLine } from "lucide-react";

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function CodeEditor({ value, language, onChange, disabled }: CodeEditorProps) {
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
    },
    [value, onChange]
  );

  useEffect(() => {
    if (textareaRef.current && !disabled) textareaRef.current.focus();
  }, [disabled]);

  const lines = value === "" ? 1 : value.split("\n").length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#2d2d2d] bg-[#131311] shadow-md">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#1A1A18] px-4 py-2">
        <span className="flex items-center gap-2 text-xs text-muted-strong">
          <FileCode2 className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono">solution.py</span>
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            disabled ? "bg-surface-muted text-muted" : "bg-success/15 text-success"
          }`}
        >
          {disabled ? <Lock className="h-3 w-3" /> : <PencilLine className="h-3 w-3" />}
          {disabled ? "Read-only · finalized" : "Editing · autosaves"}
        </span>
      </div>

      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Solution editor"
          className="h-full min-h-[420px] w-full resize-none border-none bg-transparent p-4 font-mono text-[13.5px] leading-[1.7] text-zinc-100 outline-none placeholder:text-zinc-600 disabled:opacity-60"
          placeholder={'# Write your solution here...\n# def solve(...): ...'}
        />
      </div>

      <div className="flex items-center justify-between border-t border-white/10 bg-[#0d5cab] px-4 py-1.5 text-[11px] font-medium text-white">
        <span className="flex items-center gap-2">
          <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono uppercase">{language}</span>
          <span className="hidden sm:inline">UTF-8 · LF</span>
        </span>
        <span className="font-mono tabular-nums">
          {lines} {lines === 1 ? "line" : "lines"} · {value.length} chars · Tab = 4sp
        </span>
      </div>
    </div>
  );
}
