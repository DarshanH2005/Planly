"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldAlert, ArrowRight, KeyRound, CheckCircle2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/ui/page";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMessage(data.message || "Invalid credentials or unauthorized account.");
        setLoading(false);
        return;
      }

      router.push("/today");
      router.refresh();
    } catch {
      setErrorMessage("An unexpected error occurred during authentication.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <motion.div
        initial={{ opacity: 0, transform: "translateY(8px) scale(0.99)" }}
        animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        className="glass relative grid w-full max-w-4xl overflow-hidden rounded-[20px] border border-border bg-surface shadow-lg md:grid-cols-[1.05fr_1fr]">
        {/* Brand panel — ink slab, not a gradient */}
        <div className="relative hidden flex-col justify-between gap-8 bg-[#131311] p-8 text-[#F4F2EA] md:flex dark:bg-[#1A1A18]">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.5] [background-image:radial-gradient(rgba(243,239,230,0.13)_1px,transparent_1px)] [background-size:18px_18px]"
          />
          <div className="relative flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#F4F2EA]/25 font-display text-lg">
              P
            </span>
            <div>
              <p className="font-display text-[16px] tracking-tight">Planly</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#F4F2EA]/60">Interview workbench</p>
            </div>
          </div>
          <div className="relative space-y-4">
            <h2 className="font-display text-[30px] font-medium leading-[1.08] tracking-tight">
              Train like the <em>interview.</em> Keep the evidence.
            </h2>
            <p className="max-w-sm text-[13px] leading-relaxed text-[#F4F2EA]/70">
              Timed sessions, immutable attempts, rubric debriefs and unfamiliar retests — one calm loop toward Nov 30.
            </p>
            <ul className="space-y-2 border-t border-[#F4F2EA]/15 pt-4 text-[12px] text-[#F4F2EA]/80">
              {["Session → debrief → repair → retest", "80% capacity guard, missed-day replan", "Private by default, export anytime"].map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span className="h-1 w-1 rounded-full bg-[#FF4D00]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative font-mono text-[10px] uppercase tracking-[0.14em] text-[#F4F2EA]/45">Single-owner · no public signup</p>
        </div>

        {/* Form panel */}
        <div className="p-7 md:p-8">
          <div className="mb-5 flex items-center gap-3 md:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-foreground font-display text-lg text-background">
              P
            </div>
            <div>
              <h1 className="font-display text-lg tracking-tight">Planly Workbench</h1>
              <p className="text-xs text-muted">Private SDE interview preparation</p>
            </div>
          </div>

          <div className="mb-5 hidden md:block">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Sign in</p>
            <h1 className="mt-1 font-display text-[26px] tracking-tight">Welcome back</h1>
          </div>

          <div className="mb-5 flex items-start gap-2.5 rounded-[8px] border border-border bg-surface-muted p-3 text-xs">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <p className="font-semibold">Authorized owner access</p>
              <p className="mt-1 text-[11px] text-muted">Use your provisioned Supabase account.</p>
            </div>
          </div>

          {errorMessage && (
            <div role="alert" data-testid="auth-alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[0.07] p-3.5 text-xs text-danger">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Authentication notice</p>
                <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Owner email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="candidate@planly.internal"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className={inputCls}
              />
            </div>
            <Button type="submit" disabled={loading} size="md" className="w-full">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                  Verifying…
                </span>
              ) : (
                <>
                  Access workbench <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted">
            Single-owner private installation. Non-allowlisted logins are blocked.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
