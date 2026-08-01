"use client"

import * as React from "react"
import { Textarea } from "@/components/ui/textarea"
import { applyJsonTextareaKeyDown } from "@/lib/json-textarea-utils"
import { cn } from "@/lib/utils"

export interface JsonTextareaProps extends React.ComponentProps<typeof Textarea> {
  pairing?: boolean
}

export const JsonTextarea = React.forwardRef<HTMLTextAreaElement, JsonTextareaProps>(
  ({ pairing = true, onKeyDown, onChange, value, className, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (pairing) {
        applyJsonTextareaKeyDown(e, String(value ?? ""), (next) => {
          onChange?.({
            ...e,
            target: { ...e.currentTarget, value: next },
            currentTarget: { ...e.currentTarget, value: next },
          } as React.ChangeEvent<HTMLTextAreaElement>)
        })
      }
      if (!e.defaultPrevented) {
        onKeyDown?.(e)
      }
    }

    return (
      <Textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className={cn("font-mono", className)}
        {...props}
      />
    )
  },
)

JsonTextarea.displayName = "JsonTextarea"
