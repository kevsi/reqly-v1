import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const textVariants = cva("", {
  variants: {
    variant: {
      h1: "text-2xl font-bold tracking-tight",
      h2: "text-lg font-semibold",
      h3: "text-sm font-semibold",
      body: "text-sm leading-relaxed",
      "body-sm": "text-xs leading-relaxed",
      label: "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
      caption: "text-caption text-muted-foreground",
      tab: "text-tab font-medium",
      code: "text-xs font-mono leading-relaxed",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

export interface TextProps extends React.ComponentProps<"span">, VariantProps<typeof textVariants> {
  asChild?: boolean;
}

function Text({ className, variant, asChild = false, ...props }: TextProps) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="text" className={cn(textVariants({ variant }), className)} {...props} />;
}

export { Text, textVariants };
