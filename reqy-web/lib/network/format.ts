/**
 * Human-readable formatting of a byte count, using French units
 * (octets / Ko / Mo / Go) and a dot decimal separator.
 *
 * Used to display the real size of request/response payloads in the UI.
 * No FCFA / data-cost estimation is performed here (see plan P2.1 note).
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatDataSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(2)} Ko`;
  if (bytes < GB) return `${(bytes / MB).toFixed(2)} Mo`;
  return `${(bytes / GB).toFixed(2)} Go`;
}
