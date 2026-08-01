/**
 * Dedicated module for computing local push changes from store diffs.
 *
 * Re-exports `computePushChanges` from the shared store-sync module so that
 * imports remain clean and the push pipeline has a single, well-defined entry
 * point.
 */

export { computePushChanges } from "./store-sync";
export type { LocalPushChange } from "./store-sync";
