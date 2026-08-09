import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#080808",
          color: "#f1eee7",
          fontFamily: "Arial, sans-serif",
          fontWeight: 800,
          lineHeight: 0.9,
        }}
      >
        <span style={{ fontSize: 27, letterSpacing: -2 }}>LNX</span>
        <span style={{ marginTop: 5, color: "#e2c47e", fontSize: 10, letterSpacing: 3 }}>BEATS</span>
      </div>
    ),
    size,
  );
}
