import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        cited: "bg-[var(--cite-bg)] text-[var(--cite)]",
        detected: "bg-[var(--cite-bg)] text-[var(--cite)]",
        brand: "bg-[#EFF6FF] text-[#1D4ED8]",
        notDetected: "bg-[var(--seen-bg)] text-[var(--seen)]",
        none: "bg-[var(--none)] text-[var(--muted)]",
      },
    },
    defaultVariants: {
      variant: "none",
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
