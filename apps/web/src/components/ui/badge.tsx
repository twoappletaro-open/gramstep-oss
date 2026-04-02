import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-steel-300 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-powder-100 text-powder-700",
        secondary: "border-transparent bg-cream-100 text-cobalt-600",
        destructive: "border-transparent bg-terra-100 text-terra-700",
        outline: "text-cobalt-700 border-gray-200",
        warning: "border-transparent bg-warning-100 text-warning-600",
        steel: "border-transparent bg-steel-100 text-steel-700",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
