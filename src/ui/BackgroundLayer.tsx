import type { Background } from "../types";

export function BackgroundLayer({ bg }: { bg: Background }) {
  const dim = bg.dim ?? 0;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
      {bg.kind === "video" ? (
        <video
          src={bg.value}
          autoPlay
          loop
          muted
          playsInline
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: bg.kind === "color" ? bg.value : "#0b0d12",
            backgroundImage: bg.kind === "image" ? `url("${bg.value}")` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      {dim > 0 && (
        <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${dim})` }} />
      )}
    </div>
  );
}
