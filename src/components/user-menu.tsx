"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/ui/tooltip";

export function UserMenu({ email = "developer@example.com" }: { email?: string }) {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    }
  }

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2.5">
      <DropdownMenu>
        <Tip label={email}>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full outline-none transition-transform hover:scale-105 active:scale-95" aria-label="Account menu">
              <Avatar className="h-7 w-7 ring-2 ring-border">
                <AvatarFallback>{email.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <span className="flex items-center gap-2 font-normal normal-case tracking-normal">
              <UserRound className="h-3.5 w-3.5 text-muted" />
              <span className="truncate text-xs text-muted">{email}</span>
            </span>
            <span className="mt-1 block text-[13px] font-semibold text-foreground">Private owner</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <Settings /> Workbench settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/weekly")}>
            <UserRound /> Weekly review
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleLogout}
            className="text-red-600 focus:bg-danger/10 focus:text-danger"
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
