export const dynamic = "force-dynamic";

function getStatus() {
  const ready = Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return {
    ready,
    message: ready ? "Paper signal intake configured" : "Add webhook secret and Supabase journal credentials in Vercel"
  };
}

export default function Home() {
  const status = getStatus();
  return <main>
    <header className="top"><div className="brand"><div className="mark">M</div><div><h1>MacSignalTrades</h1><p>ICT / SMC signal intelligence</p></div></div><div className="status">● SIGNALS ONLY · NO AUTO-TRADING</div></header>
    <section className="hero"><div className="eyebrow">STRICT VALIDATION ENGINE · PAPER MODE</div><h2>Trade the setup.<br/>Not the noise.</h2><p>Forex, Gold and Crypto. A signal is accepted only when every required higher-timeframe, liquidity, displacement, structure, entry-zone and risk gate passes.</p></section>
    <section className="grid">
      <div className="card"><small>ENGINE STATUS</small><div className="value">{status.ready ? "Configured" : "Setup pending"}</div><div className="sub">{status.message}</div></div>
      <div className="card"><small>PUBLISHING MODE</small><div className="value">Paper only</div><div className="sub">Signals are journalled; Telegram publishing and order execution are off</div></div>
      <div className="card"><small>MARKETS</small><div className="value">FX · XAU · Crypto</div><div className="sub">TradingView webhook intake · 5M entry confirmation</div></div>
    </section>
    <section className="section">
      <div className="card"><h3>Strict validation sequence</h3><div className="steps">
        <div className="step"><div className="dot">01</div><div><b>4H directional context</b><span>Higher-timeframe bias must align with the proposed direction.</span></div></div>
        <div className="step"><div className="dot">02</div><div><b>Liquidity event</b><span>Require a BSL / SSL raid or confirmed range sweep. A sweep alone never qualifies.</span></div></div>
        <div className="step"><div className="dot">03</div><div><b>5M displacement + MSS</b><span>Displacement and a confirmed market-structure shift by candle close are mandatory.</span></div></div>
        <div className="step"><div className="dot">04</div><div><b>Entry zone + risk</b><span>Require an unmitigated FVG / IFVG / OB, structural stop, external liquidity target and at least 1.5R.</span></div></div>
        <div className="step"><div className="dot">05</div><div><b>Paper journal</b><span>Deduplicate and record accepted setups. Nothing is sent to Telegram.</span></div></div>
      </div></div>
      <div className="card"><h3>Integration status</h3><div className="steps">
        <div className="step"><div className="dot">•</div><div><b>TradingView</b><span>Authenticated webhook intake is implemented. Alert logic must calculate and send the confirmation fields.</span></div></div>
        <div className="step"><div className="dot">•</div><div><b>Supabase</b><span>Required for persistent paper journal and duplicate protection. Apply supabase/schema.sql.</span></div></div>
        <div className="step"><div className="dot">•</div><div><b>MT5 / scanner</b><span>Broker-feed bridge and full candle-based ICT/SMC detection are not yet implemented.</span></div></div>
      </div><div className="notice" style={{marginTop:20}}>Fail-closed: missing confirmations, stale candles, malformed prices, low R:R or unavailable journal storage are rejected. This webhook validates supplied confirmations; it does not independently discover setups or verify broker candles.</div></div>
    </section>
    <footer className="footer"><span>MacSignalTrades · Strict paper release</span><span><a href="https://t.me/macsignaltrades" target="_blank" rel="noreferrer">Telegram channel ↗</a></span></footer>
  </main>;
}
