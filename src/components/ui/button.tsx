"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const buttonVariants = cva(
  "pressable inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:brightness-[1.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]",
        secondary: "bg-surface-muted text-foreground border border-border hover:bg-surface-hover hover:border-border-strong",
        ghost: "text-muted hover:text-foreground hover:bg-surface-muted",
        outline: "bg-surface text-foreground border border-border hover:border-border-strong hover:bg-surface-muted shadow-xs",
        success: "bg-success text-white shadow-xs hover:brightness-110 dark:text-[#141311]",
        warning: "bg-warning text-white shadow-xs hover:brightness-110 dark:text-[#141311]",
        danger: "bg-danger text-white shadow-xs hover:brightness-95",
        dark: "bg-foreground text-background hover:opacity-85",
        link: "text-primary underline-offset-4 hover:underline !px-0",
      },
      size: {
        xs: "h-7 px-2.5 text-[11px]",
        sm: "h-8 px-3.5 text-xs",
        md: "h-10 px-5 text-[13px]",
        lg: "h-11 px-6 text-sm",
        icon: "h-8 w-8",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: { variant: "primary", size: "sm" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

// Legacy compat: Card + SectionLabel live here too (used across views)
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-xs", className)}
      {...props}
    />
  );
}

export function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("text-[11px] font-semibold uppercase tracking-[0.08em] text-muted", className)}>
      {children}
    </p>
  );
}
