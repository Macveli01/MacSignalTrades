export const dynamic = "force-dynamic";
async function getStatus() {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    if (!base) return { ready: false, message: "Waiting for deployment configuration" };
    const r = await fetch(`${base}/api/health`, { cache: "no-store" });
    return await r.json();
  } catch { return { ready: false, message: "Status unavailable" }; }
}
export default async function Home() {
  const status = await getStatus();
  return <main>
    <header className="top"><div className="brand"><div className="mark">M</div><div><h1>MacSignalTrades</h1><p>ICT / SMC signal intelligence</p></div></div><div className="status">● SIGNALS ONLY · NO AUTO-TRADING</div></header>
    <section className="hero"><div className="eyebrow">MARKET VALIDATION ENGINE</div><h2>Trade the setup.<br/>Not the noise.</h2><p>One clean workflow for Forex, Gold and Crypto. Signals are accepted only after the required higher-timeframe context, liquidity, displacement, structure and risk checks pass.</p></section>
    <section className="grid">
      <div className="card"><small>ENGINE STATUS</small><div className="value">{status.ready ? "Online" : "Setup pending"}</div><div className="sub">{status.message || "API health check"}</div></div>
      <div className="card"><small>PUBLICATION MODE</small><div className="value">Manual hold</div><div className="sub">Automatic publishing remains disabled until verified</div></div>
      <div className="card"><small>MARKETS</small><div className="value">FX · XAU · Crypto</div><div className="sub">TradingView webhook intake planned</div></div>
    </section>
    <section className="section">
      <div className="card"><h3>Signal validation sequence</h3><div className="steps">
        <div className="step"><div className="dot">01</div><div><b>4H directional context</b><span>Confirm higher-timeframe bias before looking for entries.</span></div></div>
        <div className="step"><div className="dot">02</div><div><b>Liquidity event</b><span>Require a confirmed BSL / SSL raid or range sweep. A sweep alone is never a signal.</span></div></div>
        <div className="step"><div className="dot">03</div><div><b>5M displacement + MSS</b><span>Require displacement and a candle close through confirmed structure.</span></div></div>
        <div className="step"><div className="dot">04</div><div><b>Entry zone + risk</b><span>Verify an unmitigated FVG / IFVG / OB, structural stop, target and minimum 1.5R.</span></div></div>
        <div className="step"><div className="dot">05</div><div><b>Journal + Telegram</b><span>Deduplicate, record and publish only after all gates pass.</span></div></div>
      </div></div>
      <div className="card"><h3>Connection checklist</h3><div className="steps">
        <div className="step"><div className="dot">•</div><div><b>TradingView</b><span>Webhook endpoint is included; live alert rules and feed still need configuring.</span></div></div>
        <div className="step"><div className="dot">•</div><div><b>Supabase</b><span>Required for persistent signal history and duplicate protection.</span></div></div>
        <div className="step"><div className="dot">•</div><div><b>Telegram</b><span>Set a newly rotated bot token in Vercel environment variables.</span></div></div>
      </div><div className="notice" style={{marginTop:20}}>Safety default: missing, stale, unconfirmed or malformed market data is rejected. No signal is generated from invented prices or a liquidity sweep alone.</div></div>
    </section>
    <footer className="footer"><span>MacSignalTrades · Validation-first release</span><span><a href="https://t.me/macsignaltrades" target="_blank" rel="noreferrer">Telegram channel ↗</a></span></footer>
  </main>;
}