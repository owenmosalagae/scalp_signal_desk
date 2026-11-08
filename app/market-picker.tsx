'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import type { DeskState } from '@/lib/contracts';
import { groupMarkets, marketIdentity } from '@/lib/deriv/market-groups';
import { STRATEGIES } from '@/lib/deriv/types';
import type { Market, StrategyId } from '@/lib/deriv/types';

type Props = { streams: DeskState['streams']; current: DeskState['streams'][number]; catalog: Market[]; busy: boolean; onSelect: (id: string) => void };
export default function MarketPicker({ streams, current, catalog, busy, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const strategies = groupMarkets(streams, current, catalog);
  const strategy = current.strategyId || 'scalp_ribbon';
  const choices = strategies[strategy];
  const matching = choices.filter(({ stream }) => (stream.symbol + ' ' + (stream.symbolCode || '')).toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...new Set(matching.map(choice => choice.group))];
  function changeStrategy(next: StrategyId) {
    const candidates = strategies[next];
    const target = candidates.find(choice => marketIdentity(choice.stream) === marketIdentity(current)) || candidates[0];
    if (target) { setQuery(''); onSelect(target.stream.streamId); }
  }
  return <section className="market-navigation" aria-label="Markets by strategy">
    <div className="market-navigation-fields">
      <label className="market-navigation-field">View strategy<select aria-label="Market strategy" value={strategy} disabled={busy} onChange={event => changeStrategy(event.target.value as StrategyId)}>
        {(Object.keys(STRATEGIES) as StrategyId[]).map(id => <option key={id} value={id} disabled={!strategies[id].length}>{STRATEGIES[id].name} ({strategies[id].length})</option>)}
      </select></label>
      <label className="market-navigation-field market-find">Find a market<span><Search size={14} aria-hidden="true"/><input aria-label="Search strategy markets" placeholder="Search pair or index" value={query} onChange={event => setQuery(event.target.value)}/></span></label>
      <label className="market-navigation-field">Market<select aria-label="Select monitored market" value={current.streamId} disabled={busy} onChange={event => onSelect(event.target.value)}>
        {!matching.some(choice => choice.stream.streamId === current.streamId) && <optgroup label="Selected market"><option value={current.streamId}>{current.symbol}</option></optgroup>}
        {groups.map(group => <optgroup key={group} label={group}>{matching.filter(choice => choice.group === group).map(({ stream }) => <option key={stream.streamId} value={stream.streamId}>{stream.symbol}</option>)}</optgroup>)}
      </select></label>
    </div>
    <p className="market-navigation-note" role="status">{matching.length ? `${matching.length} market${matching.length === 1 ? '' : 's'} · ${STRATEGIES[strategy].name}` : 'No matching markets. Clear your search to see this strategy’s markets.'}<span>Use the chart selector for timeframes. Change the active scanner strategy in Manage markets.</span></p>
  </section>;
}
