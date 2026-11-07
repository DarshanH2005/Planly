"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Cpu, Brain, Sparkles } from "lucide-react";

interface SubjectNavProps {
  currentTrack: string;
  onSelectTrack: (track: string) => void;
  stage?: string;
  mode?: string;
}

const TRACKS = [
  { id: "dsa", label: "DSA", icon: BookOpen, description: "Algorithms & Data Structures" },
  { id: "cs", label: "CS Fundamentals", icon: Cpu, description: "Systems & Architecture" },
  { id: "ai_ml", label: "AI & ML", icon: Brain, description: "Machine Learning & Models" },
];

export function SubjectNav({ currentTrack, onSelectTrack, stage = "foundation", mode = "learn" }: SubjectNavProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-card border-b border-border"
      data-testid="subject-nav"
    >
      {/* Subject switcher tabs */}
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Subjects">
        {TRACKS.map((t) => {
          const Icon = t.icon;
          const isActive = currentTrack.toLowerCase() === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelectTrack(t.id)}
              className={`pressable flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
              data-testid={`subject-tab-${t.id}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Stage and Mode Indicators */}
      <div className="flex items-center gap-2 text-xs">
        <Badge tone="neutral" className="text-[11px] capitalize">
          Stage: {stage}
        </Badge>
        <Badge
          tone={mode === "learn" ? "neutral" : "emerald"}
          className="text-[11px] capitalize"
        >
          <Sparkles className="w-3 h-3 mr-1" />
          Mode: {mode}
        </Badge>
      </div>
    </div>
  );
}
