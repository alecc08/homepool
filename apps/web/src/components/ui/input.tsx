import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[8px] border border-[#dde3ec] bg-[#f8fafc] px-3 py-2 text-[13px] font-[family-name:Sora,system-ui,sans-serif] text-[#0f172a] ring-offset-background placeholder:text-[#94a3b8] focus-visible:outline-none focus-visible:border-[#2dd4bf] focus-visible:ring-[3px] focus-visible:ring-[rgba(45,212,191,0.12)] disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
