"use client";

import * as React from "react";
import { CheckCircle2, KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import { Button, Card } from "@/components/ui/button";
import {
  learningApi,
  type ProviderCredentialStatus,
  type ProviderCredentialsResponse,
} from "@/lib/api/learning-client";

const PROVIDERS = [
  { key: "gemini", name: "Google Gemini", envName: "GEMINI_API_KEY" },
  { key: "openai", name: "OpenAI", envName: "OPENAI_API_KEY" },
] as const;

export function ProviderCredentialsEditor() {
  const [providers, setProviders] = React.useState<Record<string, ProviderCredentialStatus>>({});
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const applyResponse = (response: ProviderCredentialsResponse) => {
    setProviders(response.providers);
    setValues({});
  };

  const loadCredentials = React.useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      applyResponse(await learningApi.getProviderCredentials());
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load provider credentials." });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCredentials();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCredentials]);

  const save = async (provider: string) => {
    const value = values[provider]?.trim();
    if (!value) {
      setMessage({ type: "error", text: "Enter a new API key before saving." });
      return;
    }
    setSaving(provider);
    setMessage(null);
    try {
      applyResponse(await learningApi.saveProviderCredential(provider, value));
      setMessage({ type: "success", text: "Provider key saved securely on the API service." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save provider key." });
    } finally {
      setSaving(null);
    }
  };

  const remove = async (provider: string) => {
    if (!window.confirm("Remove this provider key from Planly?")) return;
    setSaving(provider);
    setMessage(null);
    try {
      applyResponse(await learningApi.deleteProviderCredential(provider));
      setMessage({ type: "success", text: "Provider key removed from Planly." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not remove provider key." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="bg-surface p-5">
      <div className="flex items-start gap-3 border-b border-border pb-4">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Provider API Keys</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Add or replace keys here for this account only. Keys are masked in the browser, encrypted at rest by the API service, and never returned to this page.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading provider status…
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {PROVIDERS.map((provider) => {
            const status = providers[provider.key];
            const isSaving = saving === provider.key;
            return (
              <div key={provider.key} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <label className="min-w-0 flex-1 text-xs text-muted">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {provider.name}
                      {status?.configured && <span className="inline-flex items-center gap-1 text-[11px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Configured</span>}
                    </span>
                    <span className="mt-1 block">Paste a rotated key · backend variable equivalent: {provider.envName}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={values[provider.key] || ""}
                      onChange={(event) => {
                        setValues((current) => ({ ...current, [provider.key]: event.target.value }));
                        setMessage(null);
                      }}
                      placeholder={status?.configured ? "Enter a replacement key" : "Paste a new key"}
                      className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </label>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" onClick={() => void save(provider.key)} disabled={isSaving}>
                      {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                      Save key
                    </Button>
                    {status?.configured && (
                      <Button type="button" size="sm" variant="danger" onClick={() => void remove(provider.key)} disabled={isSaving}>
                        <Trash2 /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-[11px] leading-relaxed text-muted">
            Rotate any key that was previously pasted into chat, source code, or a browser field before adding the replacement here.
          </p>
          {message && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${message.type === "success" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
              {message.type === "success" && <CheckCircle2 className="h-4 w-4" />}
              <span>{message.text}</span>
              {message.type === "error" && <button type="button" onClick={() => void loadCredentials()} className="ml-auto underline underline-offset-2">Retry</button>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
