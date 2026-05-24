import { ImageResponse } from "next/og";

export const dynamic = "force-static";

const size = { width: 1024, height: 1024 };

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="780"
          height="585"
          viewBox="4 7 24 18"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="#fafafa"
            stroke="#fafafa"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M 6 9 L 6 23 L 14 16 Z M 26 9 L 26 23 L 18 16 Z"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
