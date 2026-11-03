import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-3.5 text-xs [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:text-current [&>svg~*]:pl-6",
  {
    variants: {
      variant: {
        default:
          "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]",
        destructive:
          "border-[var(--destructive-border)] bg-[var(--destructive-bg)] text-[var(--destructive-text)] [&>svg]:text-[var(--destructive)]",
        success:
          "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)] [&>svg]:text-[var(--success)]",
        warning:
          "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)] [&>svg]:text-[var(--warning)]",
        info:
          "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] [&>svg]:text-[var(--primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-xs leading-relaxed [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
