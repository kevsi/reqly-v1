import { Platform, StyleSheet, TextStyle, ViewStyle } from "react-native";

// Shared dark palette for the Hooklet app.
export const PALETTE = {
  bg: "#0b0f0d",
  card: "#141a17",
  border: "#243029",
  text: "#e7ece9",
  muted: "#8fa39a",
  accent: "#34d399",
  danger: "#f87171",
  input: "#0f1512",
};

export const methodStyle = (method: string): ViewStyle => {
  const base: ViewStyle = { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 };
  const m = method.toUpperCase();
  if (m === "GET") return { ...base, backgroundColor: "rgba(34,197,94,0.18)" };
  if (m === "POST") return { ...base, backgroundColor: "rgba(52,211,153,0.18)" };
  if (m === "DELETE") return { ...base, backgroundColor: "rgba(248,113,113,0.18)" };
  return { ...base, backgroundColor: "rgba(251,191,36,0.18)" };
};

export const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: PALETTE.bg },
  scroll: { flexGrow: 1, backgroundColor: PALETTE.bg },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: PALETTE.card,
    borderWidth: 1,
    borderColor: PALETTE.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoGlyph: { fontSize: 30 },
  title: {
    color: PALETTE.text,
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: PALETTE.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 28,
    lineHeight: 20,
  },
  form: { gap: 6 },
  label: { color: PALETTE.muted, fontSize: 12, fontWeight: "600", marginTop: 8 },
  input: {
    backgroundColor: PALETTE.input,
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: PALETTE.text,
    fontSize: 15,
  },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: PALETTE.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostBtn: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnPressed: { opacity: 0.85 },
  primaryBtnText: { color: "#0b0f0d", fontWeight: "700", fontSize: 15 },
  ghostBtnText: { color: PALETTE.accent, fontWeight: "600", fontSize: 14 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 60 : 24,
    paddingBottom: 12,
    backgroundColor: PALETTE.bg,
  },
  headerTitle: { color: PALETTE.text, fontSize: 22, fontWeight: "700" },
  headerSub: { color: PALETTE.muted, fontSize: 12, marginTop: 2 },
  signOutBtn: {
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  signOutText: { color: PALETTE.muted, fontSize: 13 },

  tabRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
  },
  tabActive: { backgroundColor: PALETTE.accent, borderColor: PALETTE.accent },
  tabText: { color: PALETTE.muted, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#0b0f0d", fontWeight: "700" },

  content: { flex: 1 },
  contentList: { padding: 16, gap: 10 },
  card: {
    backgroundColor: PALETTE.card,
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 12,
    padding: 14,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { color: PALETTE.text, fontSize: 14, fontWeight: "600" },
  cardSub: { color: PALETTE.muted, fontSize: 12, marginTop: 3 },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle: { color: PALETTE.text, fontSize: 16, fontWeight: "600" },
  emptySub: {
    color: PALETTE.muted,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 19,
  },

  monospace: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    color: PALETTE.muted,
  },
  codeBlock: {
    backgroundColor: PALETTE.input,
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  tinyBtn: {
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tinyBtnText: { color: PALETTE.muted, fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  spacer: { height: 12 },

  chip: {
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: PALETTE.accent, borderColor: PALETTE.accent },
  chipText: { color: PALETTE.muted, fontSize: 13 },
  chipTextActive: { color: "#0b0f0d", fontWeight: "700" },
  methodText: {
    color: PALETTE.text,
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  replayTag: { color: PALETTE.muted, fontSize: 11, fontStyle: "italic", marginTop: 4 },
  eventTime: { color: PALETTE.muted, fontSize: 11, marginTop: 6 },
});

export type TextStyleObject = TextStyle;
