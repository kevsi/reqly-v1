/**
 * AI engine — action dispatch.
 *
 * `dispatchAIActions` walks a list of parsed AI actions and routes each one to
 * the corresponding handler. Missing handlers are skipped silently (with a
 * notify() for SUGGEST_FIX and unknown types). Auto-apply is gated on the
 * `allowAutoApply` option to keep destructive actions (EXECUTE_REQUEST,
 * RUN_BATCH) opt-in.
 */

import type { AIAction, AIContext, CurrentRequest, TestAssertion } from "./types";

export interface DispatchBlockedAction {
  type: string;
  reason: string;
}

export interface DispatchResult {
  blocked: DispatchBlockedAction[];
}

/**
 * Walk a `$.foo.bar`-style path against an object and stringify the result.
 * Returns `undefined` if any segment is missing.
 */
function resolvePath(obj: unknown, path: string): string | undefined {
  const cleaned = path.replace(/^\$\./, "");
  const keys = cleaned.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current != null ? String(current) : undefined;
}

/**
 * Dispatch a list of AI actions to handlers. Handlers are optional — missing
 * handlers are skipped but `notify` is invoked when relevant so the user
 * sees something happened.
 */
export async function dispatchAIActions(
  actions: AIAction[],
  handlers: {
    setRequest?: (patch: Partial<CurrentRequest>, reason?: string) => Promise<void> | void;
    addAssertions?: (assertions: TestAssertion[], autoApply?: boolean) => Promise<void> | void;
    setVariable?: (name: string, value: string, description?: string) => Promise<void> | void;
    applyFix?: (patch: Partial<CurrentRequest>) => Promise<void> | void;
    setDoc?: (markdown: string, title?: string) => Promise<void> | void;
    notify?: (message: string) => Promise<void> | void;
    executeRequest?: (request: Partial<CurrentRequest>) => Promise<any> | void;
    runBatch?: (requests: Array<Partial<CurrentRequest>>) => Promise<any[]> | void;
    audit?: (entry: { actionType: string; detail?: any; result?: any }) => Promise<any> | void;
  },
  ctx?: AIContext,
  options?: { allowAutoApply?: boolean },
): Promise<DispatchResult> {
  const blocked: DispatchBlockedAction[] = [];
  for (const action of actions) {
    switch (action.type) {
      case "FILL_REQUEST": {
        try {
          await handlers.setRequest?.(action.payload, action.payload.reason);
          // If AI requested to run the request (payload.run === true) and autoApply allowed, execute it
          try {
            const shouldRun = !!action.payload.run;
            if (shouldRun && options?.allowAutoApply) {
              const res = await handlers.executeRequest?.(action.payload);
              await handlers.audit?.({
                actionType: "FILL_REQUEST_RUN",
                detail: action.payload,
                result: res,
              });
            }
          } catch (e) {
            await handlers.notify?.(`FILL_REQUEST run error: ${String(e)}`);
          }
        } catch (e) {
          await handlers.notify?.(`FILL_REQUEST handler error: ${String(e)}`);
        }
        break;
      }

      case "ADD_ASSERTIONS": {
        try {
          const shouldAuto = Boolean(action.payload.autoApply) && Boolean(options?.allowAutoApply);
          const res = await handlers.addAssertions?.(action.payload.assertions, shouldAuto);
          if (shouldAuto) {
            await handlers.audit?.({
              actionType: "ADD_ASSERTIONS_AUTO",
              detail: action.payload,
              result: res,
            });
          }
        } catch (e) {
          await handlers.notify?.(`ADD_ASSERTIONS handler error: ${String(e)}`);
        }
        break;
      }

      case "CREATE_VARIABLE": {
        try {
          let val = action.payload.value ?? "";
          if (!val && action.payload.fromResponsePath && ctx?.lastResponse?.body) {
            val = resolvePath(ctx.lastResponse.body, action.payload.fromResponsePath) ?? "";
          }
          await handlers.setVariable?.(action.payload.name, val, action.payload.description);
        } catch (e) {
          await handlers.notify?.(`CREATE_VARIABLE handler error: ${String(e)}`);
        }
        break;
      }

      case "SUGGEST_FIX": {
        try {
          await handlers.notify?.(action.payload.description ?? "Suggested fix available");
          if (action.payload.autoApply && options?.allowAutoApply) {
            if (action.payload.patch) {
              const res = await handlers.applyFix?.(action.payload.patch);
              await handlers.audit?.({
                actionType: "SUGGEST_FIX_AUTO",
                detail: action.payload,
                result: res,
              });
            }
          }
        } catch (e) {
          await handlers.notify?.(`SUGGEST_FIX handler error: ${String(e)}`);
        }
        break;
      }

      case "GENERATE_DOC": {
        try {
          await handlers.setDoc?.(action.payload.markdown, action.payload.title);
        } catch (e) {
          await handlers.notify?.(`GENERATE_DOC handler error: ${String(e)}`);
        }
        break;
      }

      case "EXPLAIN": {
        try {
          await handlers.notify?.(action.payload.message);
        } catch (e) {
          // Best effort
        }
        break;
      }

      case "EXECUTE_REQUEST": {
        try {
          // SECURITY FIX C1: Only execute requests when autoApply is explicitly true AND allowed by options
          if (action.payload.reason && !options?.allowAutoApply) {
            await handlers.notify?.(
              `Exécution de la requête bloquée : l'application automatique n'est pas activée. Vérifie et exécute manuellement.`,
            );
            blocked.push({ type: "EXECUTE_REQUEST", reason: "allowAutoApply désactivé" });
            break;
          }
          await handlers.setRequest?.(action.payload, action.payload.reason);
          const res = await handlers.executeRequest?.(action.payload);
          await handlers.audit?.({
            actionType: "EXECUTE_REQUEST",
            detail: action.payload,
            result: res,
          });
        } catch (e) {
          await handlers.notify?.(`EXECUTE_REQUEST handler error: ${String(e)}`);
        }
        break;
      }

      case "RUN_BATCH": {
        try {
          // SECURITY FIX C1: Only execute batches when autoApply is explicitly allowed
          if (!options?.allowAutoApply) {
            await handlers.notify?.(
              `Exécution par lots bloquée : l'application automatique n'est pas activée. Vérifie les requêtes manuellement.`,
            );
            blocked.push({ type: "RUN_BATCH", reason: "allowAutoApply désactivé" });
            break;
          }
          const results: any[] = [];
          for (const req of action.payload.requests) {
            const res = await handlers.executeRequest?.(req);
            results.push({ request: req, result: res });
          }
          await handlers.runBatch?.(action.payload.requests);
          await handlers.audit?.({
            actionType: "RUN_BATCH",
            detail: action.payload,
            result: results,
          });
        } catch (e) {
          await handlers.notify?.(`RUN_BATCH handler error: ${String(e)}`);
        }
        break;
      }

      default: {
        await handlers.notify?.(`Unknown action type: ${(action as { type: string }).type}`);
        break;
      }
    }
  }

  return { blocked };
}
