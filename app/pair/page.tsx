export const dynamic = "force-dynamic";
export default async function Pair({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const key = typeof query.key === "string" ? query.key : "";
  const port = typeof query.port === "string" ? query.port : "";
  const state = typeof query.state === "string" ? query.state : "";
  return <main className="pair-page"><div className="pair-card">
    <div className="brand-mark">S</div><p className="eyebrow">SCALP SIGNAL DESK</p>
    <h1>Connect this computer.</h1>
    <p>Pair the MT5 connector running on this Windows computer with your private signal desk.</p>
    <p className="muted">Continue only if you just started the connector yourself. Your connection key is encrypted for this connector. If you chose to remember pairing, it will be saved using Windows Data Protection for your Windows account.</p>
    <form method="post" action="/api/pair">
      <input type="hidden" name="key" value={key}/><input type="hidden" name="port" value={port}/><input type="hidden" name="state" value={state}/>
      <button className="button primary" type="submit">Pair my MT5 connector ↗</button>
    </form><a className="text-link" href="/">Return to signal desk</a>
  </div></main>;
}
