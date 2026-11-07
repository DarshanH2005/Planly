"use client";

import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="mx-auto max-w-md text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10">
            <AlertTriangle className="h-6 w-6 text-danger" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Application Encountered an Error</h1>
          <p className="mx-auto mt-2 text-sm leading-relaxed text-muted">
            Planly encountered an unexpected error. Your offline work and persisted data are safe.
            {error.message ? ` (${error.message})` : ""}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Reload Application
            </Button>
            <Button variant="secondary" onClick={() => router.push("/")}>
              <Home className="h-3.5 w-3.5" /> Return to Home
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
