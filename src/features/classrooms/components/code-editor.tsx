"use client";

import React, { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Code2, Save, FileCode, Check, AlertCircle } from "lucide-react";

interface CodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  savedRevision: number;
  isDraftModified: boolean;
  onSaveArtifact?: () => void;
  isSaving?: boolean;
  readOnly?: boolean;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  savedRevision,
  isDraftModified,
  onSaveArtifact,
  isSaving = false,
  readOnly = false,
  className = "",
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const baseTheme = EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: "13px",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "inherit",
        },
        ".cm-content": {
          padding: "12px 4px",
          caretColor: "currentColor",
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-line": {
          padding: "0 8px",
          lineHeight: "1.6",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--border, rgba(120, 120, 120, 0.15))",
          color: "var(--muted-foreground, #888)",
        },
      },
      { dark: false }
    );

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        lineNumbers(),
        python(),
        baseTheme,
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextVal = update.state.doc.toString();
            if (nextVal !== valueRef.current) {
              onChangeRef.current(nextVal);
            }
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly]);

  // Update external document changes if not originating from editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      className={`flex flex-col h-full rounded-lg border border-border bg-card overflow-hidden ${className}`}
      data-testid="code-editor-container"
    >
      {/* Editor Header: Revision & Pending / Saved Indicators (B09-AC2) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 text-xs">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">Python Solution</span>
          <Badge tone="neutral" className="text-[11px] px-2 py-0">
            Rev {savedRevision}
          </Badge>
          {isDraftModified ? (
            <span
              className="inline-flex items-center gap-1 text-amber-500 font-medium text-[11px]"
              data-testid="draft-status-modified"
            >
              <AlertCircle className="w-3 h-3" />
              Unsaved draft
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-emerald-500 font-medium text-[11px]"
              data-testid="draft-status-saved"
            >
              <Check className="w-3 h-3" />
              Saved
            </span>
          )}
        </div>

        {onSaveArtifact && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSaveArtifact}
            disabled={isSaving || !isDraftModified}
            className="h-7 text-xs px-2.5 gap-1.5"
            data-testid="save-code-btn"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? "Saving..." : "Save Draft"}
          </Button>
        )}
      </div>

      {/* CodeMirror Surface */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto focus:outline-none min-h-[220px]"
        tabIndex={0}
        aria-label="Code Editor"
        role="region"
      />
    </div>
  );
}
