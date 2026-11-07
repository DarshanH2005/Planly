import Link from "next/link";
import { ArrowLeft, BookOpen, Layers, Tag, CheckCircle2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { loadCatalogue } from "@/features/curriculum/service";

interface ProblemDetailPageProps {
  params: Promise<{
    problemId: string;
  }>;
}

export default async function ProblemDetailPage({ params }: ProblemDetailPageProps) {
  const { problemId } = await params;
  const catalogue = loadCatalogue();
  const problem = catalogue.find(
    (p) => p.id.toUpperCase() === problemId.toUpperCase()
  );

  if (!problem) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-12">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Link href="/prep" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Prep Hub
          </Link>
        </div>

        <Card className="p-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted" />
          <h1 className="mt-3 text-base font-semibold">Problem not found</h1>
          <p className="mt-1 text-xs text-muted">
            The catalogue ID &quot;{problemId}&quot; does not match any of the 198 canonical curriculum entries.
          </p>
          <div className="mt-4">
            <Link href="/prep">
              <Button size="sm">Return to Catalogue</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/prep" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Prep Hub
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{problem.id}</span>
      </div>

      <PageHeader
        title={`${problem.id}: ${problem.title}`}
        description={`Group ${problem.sourceGroupNumber}: ${problem.sourceGroupName}`}
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" /> Pattern & Algorithmic Notes
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">
              {problem.patternNote}
            </p>

            <div className="mt-6 border-t border-border/60 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Pattern Family Associations
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {problem.familyIds.map((fam) => (
                  <Badge key={fam} tone="blue" className="font-mono text-xs">
                    Family {fam}
                  </Badge>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Metadata
            </h3>
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Problem ID:</span>
                <span className="font-mono font-medium text-foreground">{problem.id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Target Tier:</span>
                <Badge
                  tone={
                    problem.tier === "A"
                      ? "emerald"
                      : problem.tier === "B"
                      ? "amber"
                      : "zinc"
                  }
                >
                  Tier {problem.tier}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Source Group:</span>
                <span className="font-mono text-foreground">#{problem.sourceGroupNumber}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Practice Status
            </h3>
            <p className="mt-2 text-xs text-muted">
              Select or generate a session pack containing this prompt in the Arena to record attempt evidence.
            </p>
            <div className="mt-4">
              <Link href="/sprints">
                <Button size="sm" className="w-full">
                  View in Sprint Planner
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
