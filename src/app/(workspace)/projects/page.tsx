import { FolderGit2, Code2, Server, ShieldCheck, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PortfolioProject {
  id: string;
  name: string;
  tagline: string;
  architecture: string;
  techStack: string[];
  keyInvariants: string[];
  readinessScore: number;
}

const projects: PortfolioProject[] = [
  {
    id: "proj-01",
    name: "Planly Adaptive Workbench",
    tagline: "Adaptive AI interview training platform with deterministic planning and RLS isolation.",
    architecture: "Next.js 16 App Router · Supabase PostgreSQL with RLS · Composite tenant keys",
    techStack: ["TypeScript", "Next.js 16", "PostgreSQL", "Supabase", "Tailwind 4", "Vitest"],
    keyInvariants: [
      "Strict single-owner allowlist with composite primary keys (owner_id, id)",
      "Zero candidate leakage: private reference answers and rubrics stripped before client delivery",
      "Deterministic 80% capacity planning guard with linear repair-retest loop",
    ],
    readinessScore: 94,
  },
  {
    id: "proj-02",
    name: "Event-Driven Distributed Pipeline",
    tagline: "High-throughput asynchronous ingestion stream with deduplication and idempotency.",
    architecture: "Kafka · Redis deduplication window · PostgreSQL Outbox Pattern",
    techStack: ["Python", "FastAPI", "Apache Kafka", "Redis", "PostgreSQL", "Docker"],
    keyInvariants: [
      "Exactly-once processing semantics through unique mutation receipts and payload hashes",
      "Dynamic backpressure and dead-letter queue (DLQ) automated retry isolation",
      "Sustained 50,000 req/s benchmark under network partition simulation",
    ],
    readinessScore: 88,
  },
];

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <PageHeader
        title="Projects & Portfolio Defense"
        description="Core technical projects, architecture invariants, and defense talking points."
      />

      <div className="grid grid-cols-1 gap-5">
        {projects.map((project) => (
          <Card key={project.id} className="p-6 transition-colors hover:border-border-strong">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-primary">
                  <FolderGit2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight">{project.name}</h2>
                  <p className="mt-0.5 text-xs text-muted">{project.tagline}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge tone="emerald">
                  Defense Verified
                </Badge>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-surface-muted/60 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted">
                <Server className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono text-[11px] text-foreground">{project.architecture}</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Architectural Invariants & Trade-offs
              </h3>
              <ul className="space-y-1.5 text-xs text-foreground/90">
                {project.keyInvariants.map((inv, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    <span>{inv}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Stack:
              </span>
              {project.techStack.map((tech) => (
                <span
                  key={tech}
                  className="rounded bg-surface-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-strong"
                >
                  {tech}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
