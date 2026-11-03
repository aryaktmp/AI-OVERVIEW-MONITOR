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
          "border-transparent bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
        outline:
          "border border-[var(--line)] text-[var(--ink)]",
        cited: "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)] font-medium",
        detected: "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)] font-medium",
        brand: "border border-[var(--primary-subtle)] bg-[var(--primary-subtle)] text-[var(--primary)] font-medium",
        notDetected: "border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)] font-medium",
        none: "border border-[var(--line)] bg-[var(--none)] text-[var(--muted)] font-medium",
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
