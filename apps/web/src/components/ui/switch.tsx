import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onCheckedChange?: (checked: boolean) => void;
};

const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, checked, ...props }, ref) => (
    <label className={cn("relative inline-flex h-6 w-11 cursor-pointer items-center", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <div className="h-6 w-11 rounded-full bg-cream-200 transition-colors peer-checked:bg-steel-500 peer-focus-visible:ring-2 peer-focus-visible:ring-steel-300 peer-focus-visible:ring-offset-2" />
      <div className="absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
    </label>
  ),
);
Switch.displayName = "Switch";

export { Switch };
export type { SwitchProps };
