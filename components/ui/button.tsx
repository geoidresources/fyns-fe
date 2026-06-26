import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => {
    const variants = {
      primary: "bg-[#C97A4E] text-white hover:bg-[#b06941] shadow-[0_0_15px_rgba(201,122,78,0.2)]",
      secondary: "bg-[#1E2028] text-white hover:bg-[#2A2D35] border border-white/5",
      outline: "border border-white/10 bg-transparent hover:bg-white/5 text-white",
      ghost: "hover:bg-white/5 text-[#9CA3AF] hover:text-white",
      destructive: "bg-red-500/90 text-white hover:bg-red-500",
    };

    const sizes = {
      default: "h-10 px-4 py-2 text-sm",
      sm: "h-9 rounded-md px-3 text-sm",
      lg: "h-12 rounded-md px-6 text-base",
      icon: "h-9 w-9",
    };

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
