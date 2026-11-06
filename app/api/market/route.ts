import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "ETHUSD"];

export async function GET() {
  const url = new URL("https://biquote.io/api/latest");
  for (const symbol of SYMBOLS) url.searchParams.append("symbols", symbol);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { connected: false, error: `Market feed returned HTTP ${response.status}`, quotes: {} },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data = await response.json() as Record<string, any>;
    const quotes: Record<string, {
      mid: number;
      timestamp?: string;
      marketState?: string;
      stale?: boolean;
      quoteAgeSeconds?: number;
    }> = {};

    for (const symbol of SYMBOLS) {
      const item = data?.[symbol];
      if (!item || typeof item.mid !== "number" || !Number.isFinite(item.mid)) continue;
      quotes[symbol] = {
        mid: item.mid,
        timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined,
        marketState: typeof item.marketState === "string" ? item.marketState : undefined,
        stale: item.stale === true,
        quoteAgeSeconds: typeof item.quoteAgeSeconds === "number" ? item.quoteAgeSeconds : undefined,
      };
    }

    return NextResponse.json(
      { connected: Object.keys(quotes).length > 0, quotes, updatedAt: new Date().toISOString(), source: "Biquote public market feed" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : "Market feed unavailable", quotes: {} },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
