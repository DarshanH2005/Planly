"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          fontSize: "13px",
        },
      }}
      richColors={false}
      closeButton
    />
  );
}

export { toast } from "sonner";
