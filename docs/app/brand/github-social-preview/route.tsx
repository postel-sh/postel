import { ImageResponse } from "next/og";

export const dynamic = "force-static";

const size = { width: 1280, height: 640 };

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          color: "#fafafa",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <svg
            width="96"
            height="96"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#fafafa"
              stroke="#fafafa"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              d="M 6 9 L 6 23 L 14 16 Z M 26 9 L 26 23 L 18 16 Z"
            />
          </svg>
          <div
            style={{
              fontSize: "76px",
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            Postel
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              fontSize: "60px",
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              maxWidth: "1100px",
            }}
          >
            Webhooks as a feature of your product.
          </div>
          <div
            style={{
              fontSize: "26px",
              color: "#a3a3a3",
              letterSpacing: "0.01em",
            }}
          >
            Reliable & secure · Standard Webhooks · Sender + receiver · Polyglot
          </div>
        </div>

        <div
          style={{
            fontSize: "20px",
            color: "#737373",
            fontStyle: "italic",
            display: "flex",
          }}
        >
          Be conservative in what you send, liberal in what you accept — Jon Postel, RFC 793
        </div>
      </div>
    ),
    { ...size },
  );
}
