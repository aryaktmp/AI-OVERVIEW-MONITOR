import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--cite)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--accent)] text-white hover:opacity-90",
        secondary:
          "border-transparent bg-[var(--none)] text-[var(--ink)] hover:opacity-90",
        destructive:
          "border-transparent bg-[#C0392B] text-white hover:opacity-90",
        outline:
          "border border-[var(--line)] text-[var(--ink)]",
        cited: "bg-[var(--cite-bg)] text-[var(--cite)]",
        detected: "bg-[var(--cite-bg)] text-[var(--cite)]",
        brand: "bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#1E3A8A]/30 dark:text-[#93C5FD]",
        notDetected: "bg-[var(--seen-bg)] text-[var(--seen)]",
        none: "bg-[var(--none)] text-[var(--muted)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
