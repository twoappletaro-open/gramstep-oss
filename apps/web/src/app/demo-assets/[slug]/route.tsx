import { ImageResponse } from "next/og";

type Params = Promise<{ slug: string }>;

const heroSize = { width: 1200, height: 630 } as const;
const squareSize = { width: 1080, height: 1080 } as const;

type CardSpec = {
  label: string;
  title: string;
  subtitle: string;
  accent: string;
  background: string;
};

const heroSpec: CardSpec = {
  label: "gramstep demo",
  title: "gramstep 初回DMデモ",
  subtitle: "初回DMから予約導線までを3分で体験できます",
  accent: "#FF8A5B",
  background: "#FFF5EA",
};

const dmSpec: CardSpec = {
  label: "step 1",
  title: "初回DM",
  subtitle: "第一印象で興味を作り、会話を始める",
  accent: "#213D5F",
  background: "#FFF7F0",
};

const surveySpec: CardSpec = {
  label: "step 2",
  title: "アンケート",
  subtitle: "回答内容でタグと温度感を取得する",
  accent: "#FF9A60",
  background: "#FFF8EF",
};

const bookingSpec: CardSpec = {
  label: "step 3",
  title: "予約導線",
  subtitle: "希望日程の回収まで自然につなぐ",
  accent: "#173F63",
  background: "#FFF3EB",
};

const overviewSpec: CardSpec = {
  label: "flow",
  title: "初回デモの流れ",
  subtitle: "初回DM・アンケート・予約導線を順番に体験できます",
  accent: "#FF8A5B",
  background: "#FFF6ED",
};

function normalizeSlug(slug: string): string {
  return slug.replace(/\.png$/i, "");
}

function frameStyle(background: string) {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    background,
    fontFamily: '"Hiragino Sans", "Noto Sans JP", sans-serif',
    color: "#10243A",
  } as const;
}

function renderHero(spec: CardSpec) {
  return (
    <div style={frameStyle(spec.background)}>
      <div
        style={{
          margin: 48,
          flex: 1,
          borderRadius: 40,
          border: "4px solid #F3D7C3",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 60px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              width: 220,
              height: 42,
              borderRadius: 999,
              background: spec.accent,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            {spec.label}
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>{spec.title}</div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: "#4F647A" }}>{spec.subtitle}</div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 220,
              height: 74,
              borderRadius: 24,
              background: spec.accent,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            START DEMO
          </div>
          <div style={{ fontSize: 24, color: "#6C7E91" }}>Instagram DMの流れをそのまま再現</div>
        </div>
      </div>
    </div>
  );
}

function renderSquare(spec: CardSpec) {
  return (
    <div style={frameStyle(spec.background)}>
      <div
        style={{
          margin: 72,
          flex: 1,
          borderRadius: 44,
          border: "4px solid #F2DDCF",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          padding: "58px 56px",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              width: 180,
              height: 42,
              borderRadius: 999,
              background: spec.accent,
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            {spec.label}
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{spec.title}</div>
          <div style={{ fontSize: 28, lineHeight: 1.45, color: "#55697D" }}>{spec.subtitle}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ height: 24, borderRadius: 999, background: "#EEF3F7" }} />
          <div style={{ height: 24, width: "82%", borderRadius: 999, background: "#EEF3F7" }} />
          <div style={{ height: 92, borderRadius: 26, background: "#F7F3EE", border: `3px solid ${spec.accent}` }} />
        </div>
      </div>
    </div>
  );
}

export async function GET(_request: Request, context: { params: Params }) {
  const { slug: rawSlug } = await context.params;
  const slug = normalizeSlug(rawSlug);

  switch (slug) {
    case "initial-demo-hero":
      return new ImageResponse(renderHero(heroSpec), heroSize);
    case "initial-demo-dm":
      return new ImageResponse(renderSquare(dmSpec), squareSize);
    case "initial-demo-survey":
      return new ImageResponse(renderSquare(surveySpec), squareSize);
    case "initial-demo-booking":
      return new ImageResponse(renderSquare(bookingSpec), squareSize);
    case "initial-demo-overview":
      return new ImageResponse(renderSquare(overviewSpec), squareSize);
    default:
      return new Response("Not Found", { status: 404 });
  }
}
