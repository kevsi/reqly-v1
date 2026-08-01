import { authRules } from "./auth";
import { formatRules } from "./format";
import { performanceRules } from "./performance";
import { sslRules } from "./ssl";
import { serverRules } from "./server";
import type { Rule } from "@/src/ai/types";

export const allRules: Rule[] = [
  ...authRules,
  ...formatRules,
  ...performanceRules,
  ...sslRules,
  ...serverRules,
];

export { authRules, formatRules, performanceRules, sslRules, serverRules };
