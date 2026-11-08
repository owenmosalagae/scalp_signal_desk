"use client";
import { useEffect, useRef, useState } from "react";
import type { Signal, Snapshot } from "@/lib/contracts";

export default function RibbonChart({ stream, signal, example }: { stream: Snapshot; signal?: Signal; example: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(1000);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => setMeasuredWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const narrow = measuredWidth < 500;
  const bars = stream.candles.slice(narrow ? -44 : -112);
  if (!bars.length) return <div className="chart-empty">Loading this market’s candles…</div>;
  const session = stream.strategyId === 'session_fvg';
  const visibleSignal = signal && signal.candleTime >= bars[0].time && signal.candleTime <= bars[bars.length - 1].time ? signal : undefined;
  const range = session && stream.sessionContext?.range && stream.sessionContext.range.tradeEnd >= bars[0].time && stream.sessionContext.range.start <= bars[bars.length - 1].time + stream.timeframeSeconds ? stream.sessionContext.range : undefined;
  const zones = session ? (stream.sessionContext?.zones || []).filter(zone => zone.detectedAt <= bars[bars.length - 1].time + stream.timeframeSeconds && (zone.completedAt || zone.expiresAt) >= bars[0].time) : [];
  const width = Math.max(320, measuredWidth), height = narrow ? 270 : 340;
  const left = 12, right = narrow ? 139 : 185, top = 23, bottom = 37;
  const labelX = width - (narrow ? 132 : 174);
  const labelWidth = narrow ? 88 : 99;
  const prices = bars.flatMap(b => session ? [b.high, b.low] : [b.high, b.low, ...b.emas]);
  if (visibleSignal) prices.push(visibleSignal.stop, visibleSignal.entry, ...visibleSignal.targets);
  if (range) prices.push(range.high, range.low);
  for (const zone of zones) prices.push(zone.gapLow, zone.gapHigh);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.08, stream.tickSize * 10);
  const low = min - pad, high = max + pad;
  const y = (price: number) => top + (high - price) / (high - low) * (height - top - bottom);
  const spacing = (width - left - right) / bars.length;
  const x = (i: number) => left + spacing * (i + 0.5);
  const timeX = (time: number) => time <= bars[0].time ? left : time > bars[bars.length - 1].time ? x(bars.length - 1) + spacing / 2 : x(Math.max(0, bars.findIndex(bar => bar.time >= time))) - spacing / 2;
  const date = (time: number) => new Date(time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const hoverIndex = hover === null ? bars.length - 1 : Math.min(hover, bars.length - 1);
  const current = bars[hoverIndex];
  const coordinates = (bar: typeof current, i: number, index: number) => x(i) + "," + y(bar.emas[index]);
  const format = (price: number) => price.toFixed(stream.digits);
  const levelList = visibleSignal ? [
    { name: "SL", price: visibleSignal.stop, color: "#ef6682" },
    { name: "ENTRY", price: visibleSignal.entry, color: "#7f9ff2" },
    ...visibleSignal.targets.map((price, i) => ({ name: "TP" + (i + 1), price, color: "#69cba0" })),
  ] : [];
  const startIndex = visibleSignal ? Math.max(0, bars.findIndex(b => b.time >= visibleSignal.candleTime)) : 0;
  return <div className="chart-wrap" ref={host}>
    <div className="ohlc">
      <span className="mono">{stream.symbol}</span><span>{date(current.time)}</span>
      <span>O <b>{format(current.open)}</b></span><span>H <b>{format(current.high)}</b></span>
      <span>L <b>{format(current.low)}</b></span><span>C <b>{format(current.close)}</b></span>
    </div>
    <svg viewBox={"0 0 " + width + " " + height} className="price-chart" role="img" aria-label={(example ? "Example " : "") + stream.symbol + (session ? " candlestick chart with session range, fair value gaps and confirmed trade levels" : " candlestick chart with five EMA ribbon lines and trade levels")}
      onMouseMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = (event.clientX - rect.left) / rect.width * width;
        setHover(Math.max(0, Math.min(bars.length - 1, Math.floor((point - left) / spacing))));
      }} onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 6 }, (_, i) => {
        const price = low + (high - low) * (i + 0.5) / 6;
        return <g key={i}><line x1="0" x2={width - 74} y1={y(price)} y2={y(price)} stroke="#242a36" strokeDasharray="3 6"/>
          <text x={width - 5} y={y(price) + 4} textAnchor="end" className="axis">{format(price)}</text></g>;
      })}
      {range && [range.high, range.low].map((price, index) => <g key={'range-' + index}><line x1={timeX(range.start)} x2={timeX(range.tradeEnd)} y1={y(price)} y2={y(price)} stroke="#8daedf" strokeDasharray="5 5" opacity=".7"/><text x={timeX(range.start) + 4} y={y(price) - 5} fill="#9cb7df" fontSize="8">M15 {index === 0 ? 'HIGH' : 'LOW'}</text></g>)}
      {zones.map(zone => {
        const start = timeX(zone.detectedAt), end = timeX(zone.completedAt || zone.expiresAt), color = zone.status === 'invalidated' || zone.status === 'expired' ? '#929baa' : zone.direction === 'BUY' ? '#68cda0' : '#ef8b9e';
        return <g key={zone.id}><rect x={start} width={Math.max(1, end - start)} y={y(zone.gapHigh)} height={Math.max(1, y(zone.gapLow) - y(zone.gapHigh))} fill={color} fillOpacity=".13" stroke={color} strokeOpacity=".45"/>
          <line x1={start} x2={end} y1={y(zone.retestPrice)} y2={y(zone.retestPrice)} stroke={color} strokeDasharray="2 4" opacity=".7"/>
          {end - start > 35 && <text x={start + 4} y={y(zone.gapHigh) + 11} fill={color} fontSize="8">FVG · {zone.status.replaceAll('_', ' ')}</text>}</g>;
      })}
      {!session && bars.slice(1).map((bar, index) => {
        const previous = bars[index];
        const fill = bar.state === "Bearish" ? "#e44468" : bar.state === "Bullish" ? "#41c78c" : "#9da3ae";
        const points = [coordinates(previous, index, 0), coordinates(bar, index + 1, 0),
          coordinates(bar, index + 1, 4), coordinates(previous, index, 4)].join(" ");
        return <polygon key={bar.time} points={points} fill={fill} fillOpacity="0.17"/>;
      })}
      {!session && [0, 1, 2, 3, 4].map(index => bars.slice(1).map((bar, i) => <line key={index + ":" + bar.time}
        x1={x(i)} y1={y(bars[i].emas[index])} x2={x(i + 1)} y2={y(bar.emas[index])}
        strokeWidth="1.5"
        stroke={bar.state === "Bullish" ? "#30b87b" : bar.state === "Bearish" ? "#d13b60" : "#989eac"}/>))}
      {bars.map((bar, i) => {
        const color = bar.close >= bar.open ? "#32d294" : "#ee5772";
        return <g key={bar.time}>
          <line x1={x(i)} x2={x(i)} y1={y(bar.high)} y2={y(bar.low)} stroke={color} strokeWidth=".85"/>
          <rect x={x(i) - spacing * .30} y={Math.min(y(bar.open), y(bar.close))}
            width={spacing * .60} height={Math.max(1.1, Math.abs(y(bar.close) - y(bar.open)))} fill={color}/>
          {i % 23 === 0 && <text className="axis" x={x(i)} y={height - 12} textAnchor="middle">{date(bar.time)}</text>}
        </g>;
      })}
      {levelList.map(level => <g key={level.name}>
        <line x1={x(startIndex)} x2={labelX - 7} y1={y(level.price)} y2={y(level.price)} stroke={level.color} strokeWidth=".8" opacity=".75"/>
        <rect x={labelX} y={y(level.price) - 10} width={labelWidth} height="20" rx="3" fill="#171e2a" stroke={level.color} strokeOpacity=".3"/>
        <text x={labelX + labelWidth / 2} y={y(level.price) + 3.5} textAnchor="middle" fill={level.color} fontFamily="monospace" fontSize={narrow ? 8 : 9}>{level.name} {format(level.price)}</text>
      </g>)}
      {visibleSignal && <g>
        <rect x={x(startIndex) - 20} y={y(bars[startIndex].high) - 28} width="40" height="18" rx="3" fill={visibleSignal.direction === "SELL" ? "#dd3d62" : "#188958"}/>
        <text x={x(startIndex)} y={y(bars[startIndex].high) - 16} fill="white" textAnchor="middle" fontSize="9" fontWeight="700">{visibleSignal.direction}</text>
      </g>}
      {hover !== null && <g><line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={top} y2={height - bottom} stroke="#b1b9cb" strokeDasharray="3 5" opacity=".6"/>
        <circle cx={x(hoverIndex)} cy={y(bars[hoverIndex].close)} r="3" fill="#d6eea5"/></g>}
    </svg>
    <div className="chart-foot"><span><i className="legend-line"/> {session ? 'Session range · FVG · retest level' : 'EMA ' + stream.settings.periods.join(' / ')}</span>
      <span>{example ? "Illustrative prices" : stream.broker} · Current candle updates live</span></div>
  </div>;
}
