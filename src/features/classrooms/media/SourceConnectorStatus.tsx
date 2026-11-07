"use client";

/**
 * Sprint B27: Source Connector Status & Fallback Indicator Component
 * Authority: PLANLY_BUILD_SPEC.md §8, §10; B27_optional_sources_voice.md
 *
 * Enforces:
 * - B27-AC1: Connector failure/missing citations falls back to local references without stopping DSA.
 * - B27-AC3: Without access the feature is unavailable, never reported integrated.
 */

import React from "react";
import { BookOpen, CheckCircle2, AlertCircle, ShieldAlert, ExternalLink } from "lucide-react";
import { SourceResultContract, ConnectorStatus } from "./types";

interface SourceConnectorStatusProps {
  connectors?: Record<string, ConnectorStatus>;
  activeSource?: SourceResultContract | null;
}

export function SourceConnectorStatus({
  connectors,
  activeSource,
}: SourceConnectorStatusProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="source-connector-status">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-primary" /> Reference Connectors
        </h3>
      </div>

      {/* Connectors Status Badges (B27-AC3) */}
      {connectors && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {Object.entries(connectors).map(([key, conn]) => (
            <div
              key={key}
              className="p-2 rounded border border-border/60 bg-muted/20 space-y-1"
              data-testid={`connector-card-${key}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{key.replace("_", " ")}</span>
                {conn.available ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Available
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground font-semibold bg-muted px-1.5 py-0.5 rounded">
                    <AlertCircle className="h-2.5 w-2.5" /> Unavailable
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{conn.notes}</p>
            </div>
          ))}
        </div>
      )}

      {/* Active Source & Fallback Notification (B27-AC1) */}
      {activeSource && (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">{activeSource.title}</span>
            {activeSource.fallback_used && (
              <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                <ShieldAlert className="h-3 w-3" /> Local Reference Fallback
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {activeSource.content}
          </p>

          {/* Citations */}
          {activeSource.citations && activeSource.citations.length > 0 && (
            <div className="pt-2 border-t border-border/40 space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Verified Citations ({activeSource.citations.length})
              </span>
              {activeSource.citations.map((cit) => (
                <div
                  key={cit.source_id}
                  className="flex items-start gap-1.5 text-[11px] text-foreground bg-background/50 p-1.5 rounded"
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="italic font-serif">&ldquo;{cit.snippet}&rdquo;</p>
                    {cit.url_or_path && (
                      <span className="text-[10px] text-muted-foreground">
                        Source: {cit.url_or_path} {cit.page_or_section ? `(${cit.page_or_section})` : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
