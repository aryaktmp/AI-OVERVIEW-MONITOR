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
          "border-[#C0392B]/30 bg-[#C0392B]/10 text-[#C0392B] dark:border-[#C0392B]/40 dark:bg-[#C0392B]/20 [&>svg]:text-[#C0392B]",
        success:
          "border-[var(--cite)]/30 bg-[var(--cite-bg)] text-[var(--cite)] dark:border-[var(--cite)]/40 dark:bg-[var(--cite-bg)]/20 [&>svg]:text-[var(--cite)]",
        warning:
          "border-[var(--seen)]/40 bg-[var(--seen-bg)] text-[var(--seen)] dark:border-[#B7791F]/40 dark:bg-[#4B3A16] [&>svg]:text-[var(--seen)]",
        info:
          "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200 [&>svg]:text-blue-600",
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
