import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt =
  "Postel — Polyglot webhooks library backed by solid, executable specs.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fafafa",
          color: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <svg
            width="88"
            height="88"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#0a0a0a"
              stroke="#0a0a0a"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              d="M 6 9 L 6 23 L 14 16 Z M 26 9 L 26 23 L 18 16 Z"
            />
          </svg>
          <div
            style={{
              fontSize: "72px",
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            Postel
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: "68px",
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              maxWidth: "1000px",
            }}
          >
            Webhooks as a feature of your product.
          </div>
          <div
            style={{
              fontSize: "28px",
              color: "#525252",
              letterSpacing: "0.01em",
            }}
          >
            Polyglot · Standard Webhooks · Sender + receiver · Edge-native
          </div>
        </div>

        <div
          style={{
            fontSize: "22px",
            color: "#737373",
            fontStyle: "italic",
            display: "flex",
          }}
        >
          Be conservative in what you send, liberal in what you accept — Jon
          Postel, RFC 793
        </div>
      </div>
    ),
    { ...size },
  );
}
