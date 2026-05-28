import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-12 w-full rounded-md border border-white/5 bg-[#1A1D24] px-4 py-2 text-sm text-[#F3F4F6] transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[#6B7280] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
