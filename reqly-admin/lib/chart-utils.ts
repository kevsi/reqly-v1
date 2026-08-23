export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour12: false });
}

export function fmtBucket(ts: number, range: "1h" | "24h" | "7d"): string {
  const d = new Date(ts);
  if (range === "1h")
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (range === "24h")
    return d
      .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false })
      .replace(":00", "h");
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", hour: "numeric" });
}
