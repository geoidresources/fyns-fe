"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C97A4E] focus-visible:ring-offset-1 focus-visible:ring-offset-[#111114]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-[#C97A4E] data-[state=unchecked]:bg-[#2A2D35]",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-3.5 rounded-full bg-white shadow-sm ring-0 transition-transform",
        "data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0.5"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
