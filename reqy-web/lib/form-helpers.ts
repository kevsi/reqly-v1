import { useForm, type UseFormProps } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

/**
 * Thin wrapper around react-hook-form that wires up zod validation.
 * Keeps every L2 form in this codebase consistent.
 */
export function useZodForm<S extends z.Schema>(
  schema: S,
  defaultValues: z.infer<S>,
  options?: Omit<UseFormProps<z.infer<S>>, "resolver" | "defaultValues">,
) {
  return useForm<z.infer<S>>({
    resolver: zodResolver(schema as unknown as Parameters<typeof zodResolver>[0]),
    defaultValues,
    ...options,
  });
}
