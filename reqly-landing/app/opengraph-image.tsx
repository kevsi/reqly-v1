import { ImageResponse } from "next/og";

export const alt = "Reqly — Client API moderne, open source";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          background:
            "radial-gradient(900px 500px at 50% -10%, #0f3d2c 0%, #060b08 65%)",
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 34,
            color: "#6ee7b7",
          }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="#34d399">
            <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />
          </svg>
          Reqly
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 34,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -2,
          }}
        >
          <div>Testez, documentez et</div>
          <div>automatisez vos API</div>
        </div>

        <div style={{ marginTop: 30, fontSize: 32, color: "#a1a1aa" }}>
          REST · GraphQL · Assistant IA · Mock server · CLI &amp; MCP
        </div>

        <div style={{ marginTop: 44, display: "flex", gap: 14 }}>
          {["Open source", "Local d'abord", "Auto-hébergeable"].map((t) => (
            <div
              key={t}
              style={{
                border: "1px solid #2c4637",
                borderRadius: 999,
                padding: "10px 24px",
                fontSize: 26,
                color: "#6ee7b7",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
