"use client";

import { motion, type Variants } from "motion/react";
import type * as React from "react";

export const fadeUp: Variants = {
  hidden: { opacity: 0, transform: "translateY(8px) scale(0.99)" },
  show: (i: number = 0) => ({
    opacity: 1,
    transform: "translateY(0px) scale(1)",
    transition: { duration: 0.22, delay: Math.min(i * 0.05, 0.2), ease: [0.23, 1, 0.32, 1] },
  }),
};

export function Rise({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={fadeUp} initial="hidden" animate="show" custom={index}>
      {children}
    </motion.div>
  );
}

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
    >
      {children}
    </motion.div>
  );
}

export function Item({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
}

export { motion };
