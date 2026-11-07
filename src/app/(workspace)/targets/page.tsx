import { Building2, Calendar } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RoleTrackItem {
  company: string;
  role: string;
  tier: string;
  checkpoint: string;
  focusAreas: string[];
  status: "active" | "planned";
}

const roleTracks: RoleTrackItem[] = [
  {
    company: "CRED",
    role: "Backend Engineer / SDE-1",
    tier: "Tier-1 Product",
    checkpoint: "November 30, 2026",
    focusAreas: ["High-Concurrency State", "Kafka Pipelines", "Idempotent Services"],
    status: "active",
  },
  {
    company: "Amazon",
    role: "Software Development Engineer (SDE-1)",
    tier: "Big Tech",
    checkpoint: "November 30, 2026",
    focusAreas: ["DSA Monotone Stacks", "Graph Topologies", "Leadership Principles (STAR)"],
    status: "active",
  },
  {
    company: "Microsoft",
    role: "Software Engineer",
    tier: "Big Tech",
    checkpoint: "December 15, 2026",
    focusAreas: ["Trees & Dynamic Programming", "Object-Oriented Design", "System Invariants"],
    status: "planned",
  },
  {
    company: "Google",
    role: "Software Engineer, University Graduate",
    tier: "Big Tech",
    checkpoint: "December 31, 2026",
    focusAreas: ["Advanced Graph Relaxations", "Interval DP", "Rigorous Complexity Analysis"],
    status: "planned",
  },
];

export default function TargetsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <PageHeader
        title="Targets & Hiring Tracks"
        description="Target companies, role requirements, and milestones toward Nov 30, 2026."
      />

      <div className="grid grid-cols-1 gap-4">
        {roleTracks.map((track) => (
          <Card key={track.company} className="card-lift p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-primary">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">{track.company}</h2>
                    <p className="text-xs text-muted">{track.role}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={track.status === "active" ? "emerald" : "zinc"}>
                  {track.status === "active" ? "Primary Target" : "Secondary Target"}
                </Badge>
                <Badge tone="neutral" className="font-mono text-[11px]">
                  {track.tier}
                </Badge>
              </div>
            </div>

            <div className="mt-4 border-t border-border/60 pt-3.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Focus:
                  </span>
                  {track.focusAreas.map((area) => (
                    <span
                      key={area}
                      className="rounded bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                    >
                      {area}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1 text-xs text-muted">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    Checkpoint:{" "}
                    <strong className="font-mono font-medium text-foreground">
                      {track.checkpoint}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
