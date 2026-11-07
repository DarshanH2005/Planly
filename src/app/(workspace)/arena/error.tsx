"use client";

import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ArenaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10">
        <AlertTriangle className="h-6 w-6 text-danger" />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">Arena Assessment Error</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
        Your assessment progress and code draft are safely retained.
        {error.message ? ` (${error.message})` : ""}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Resume Session
        </Button>
        <Button variant="secondary" onClick={() => router.push("/today")}>
          <Home className="h-3.5 w-3.5" /> Back to Today
        </Button>
      </div>
    </div>
  );
}
