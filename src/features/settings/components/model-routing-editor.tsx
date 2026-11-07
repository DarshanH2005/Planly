"use client";

import * as React from "react";
import { CheckCircle2, Cpu, Info, LockKeyhole, Loader2, Save } from "lucide-react";
import { Button, Card } from "@/components/ui/button";
import { learningApi, type ModelCatalogEntry, type ModelRouteSetting } from "@/lib/api/learning-client";

const TASK_ORDER = [
  "tutor_reply",
  "lesson_assessment",
  "planner",
  "summary",
  "retrieval_rerank",
  "schema_repair",
  "reviewer",
] as const;

const TASK_LABELS: Record<string, { title: string; description: string }> = {
  tutor_reply: { title: "Tutor replies", description: "Interactive explanations and classroom responses" },
  lesson_assessment: { title: "Lesson assessment", description: "Checks whether your answer demonstrates the target skill" },
  planner: { title: "Planning", description: "Daily and weekly preparation plan generation" },
  summary: { title: "Summaries", description: "Short learning recaps and progress summaries" },
  retrieval_rerank: { title: "Retrieval reranking", description: "Selects the most useful memories and references" },
  schema_repair: { title: "Structured-output repair", description: "Repairs malformed structured model responses" },
  reviewer: { title: "Premium reviewer", description: "Reviewer access remains a server-managed policy" },
};

function formatPrice(value: number) {
  return `$${value.toFixed(2)}/M`;
}

function modelLabel(model: ModelCatalogEntry) {
  return `${model.display_name} · ${model.provider}`;
}

export function ModelRoutingEditor() {
  const [models, setModels] = React.useState<ModelCatalogEntry[]>([]);
  const [routes, setRoutes] = React.useState<Record<string, ModelRouteSetting>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadRouting = React.useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await learningApi.getModelRouting();
      setModels(response.models);
      setRoutes(response.routes);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load model routing." });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRouting();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRouting]);

  const availableModels = models.filter((model) => model.enabled);
  const updateRoute = (task: string, primary: string, fallback: string) => {
    setRoutes((current) => ({
      ...current,
      [task]: { primary, fallbacks: fallback ? [fallback] : [] },
    }));
    setMessage(null);
  };

  const saveRouting = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await learningApi.updateModelRouting(routes);
      setRoutes(response.routes);
      setMessage({ type: "success", text: "Model routing saved for this account." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save model routing." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-surface p-5">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Model Routing</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Choose which enabled model handles each kind of work. Changes are private to your account and apply to new tutor and assessment calls.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading available models…
        </div>
      ) : (
        <form onSubmit={saveRouting} className="mt-4 space-y-3">
          {TASK_ORDER.map((task) => {
            const route = routes[task];
            const taskInfo = TASK_LABELS[task];
            const protectedTask = task === "reviewer";
            if (!route || !taskInfo) return null;

            return (
              <div key={task} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{taskInfo.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{taskInfo.description}</p>
                  </div>

                  {protectedTask ? (
                    <div className="flex shrink-0 items-center gap-2 rounded-md bg-muted/10 px-3 py-2 text-xs text-muted">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      <span>{route.primary} · Server protected</span>
                    </div>
                  ) : (
                    <div className="grid w-full shrink-0 gap-2 sm:grid-cols-2 md:w-[29rem]">
                      <label className="text-xs text-muted">
                        Primary
                        <select
                          aria-label={`${taskInfo.title} primary model`}
                          value={route.primary}
                          onChange={(event) => updateRoute(task, event.target.value, route.fallbacks[0] || "")}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          {availableModels.map((model) => (
                            <option key={model.key} value={model.key}>
                              {modelLabel(model)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-muted">
                        Fallback
                        <select
                          aria-label={`${taskInfo.title} fallback model`}
                          value={route.fallbacks[0] || ""}
                          onChange={(event) => updateRoute(task, route.primary, event.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
                        >
                          <option value="">No fallback</option>
                          {availableModels.map((model) => (
                            <option key={model.key} value={model.key} disabled={model.key === route.primary}>
                              {modelLabel(model)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
                {!protectedTask && route.primary && (
                  <p className="mt-2 text-[11px] text-muted">
                    {availableModels.find((model) => model.key === route.primary)?.model_name || route.primary}
                    {availableModels.find((model) => model.key === route.primary) && (
                      <> · {formatPrice(availableModels.find((model) => model.key === route.primary)!.input_cost_per_m)} input</>
                    )}
                  </p>
                )}
              </div>
            );
          })}

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Fallbacks are used only when a provider is unavailable before a call is accepted. Reviewer protection cannot be changed here.
            </p>
            <Button type="submit" size="sm" disabled={saving || Object.keys(routes).length === 0}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save routing"}
            </Button>
          </div>

          {message && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${message.type === "success" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
              {message.type === "success" && <CheckCircle2 className="h-4 w-4" />}
              <span>{message.text}</span>
              {message.type === "error" && (
                <button type="button" onClick={() => void loadRouting()} className="ml-auto underline underline-offset-2">
                  Retry
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
