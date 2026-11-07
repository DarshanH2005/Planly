"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn";

// SOTA sheet: right-side drawer on desktop, bottom sheet on mobile.
// No new dep — Radix Dialog + CSS. Exit faster than enter, origin-aware.
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  side = "right",
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "right" | "bottom";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-160",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-120"
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "glass fixed z-50 flex flex-col border border-border bg-popover text-popover-foreground shadow-lg outline-none",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full max-w-[380px] rounded-l-2xl border-r-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-240 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-160",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl border-b-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-240 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-160",
          // Mobile: any sheet becomes bottom-anchored via parent class
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[88vh] max-sm:w-full max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0",
          className
        )}
        style={{ animationTimingFunction: "var(--ease-drawer)" }}
        {...props}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong/60 sm:hidden" aria-hidden />
        {children}
        <DialogPrimitive.Close
          aria-label="Close panel"
          className="pressable absolute right-3 top-3 rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-5 pb-3 pt-4 text-left", className)} {...props} />;
}
export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-display text-[16px] font-semibold tracking-tight", className)} {...props} />;
}
export function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[12px] leading-relaxed text-muted", className)} {...props} />;
}
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-5 pb-5", className)} {...props} />;
}
