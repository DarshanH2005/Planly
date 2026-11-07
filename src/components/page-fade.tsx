"use client";

import { motion } from "motion/react";

export function PageFade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.21, 1.02, 0.73, 1] }}>
      {children}
    </motion.div>
  );
}
