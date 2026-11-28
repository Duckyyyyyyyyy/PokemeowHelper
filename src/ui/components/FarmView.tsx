import { useMemo, useState } from 'preact/hooks';
import type { Dataset } from '../../shared/types';
import { farmGroups, type TrainRow } from '../../engine/evRoles';
import { POWER_ITEM, STAT_NAME, VITAMIN, VITAMIN_EVS, koCount, trainingAccounts, wildEvSpots, type StatKey } from '../../engine/evPlan';
import { bag, ownedItems } from '../bagStore';

/** Ticks on the Farm list (per viewer, so localStorage). */
const KEY = 'md-ev-farm';
function loadTicks(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
const itemId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Train → Farm: the box's EV needs grouped by stat, so Pokémon that need the same stat train in one
 * session; plus what to buy against the bag. GUESS: Exp. Share holders get the same EVs (as the EV
 * advice says); a Power item adds 8 per knockout its holder takes part in.
 */
export function FarmView({ ds, rows }: { ds: Dataset; rows: TrainRow[] }) {
  const groups = useMemo(() => farmGroups(rows), [rows]);
  const [ticks, setTicks] = useState<string[]>(loadTicks);
  const toggle = (k: string) => {
    const next = ticks.includes(k) ? ticks.filter((t) => t !== k) : [...ticks, k];
    setTicks(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const name = (sp: number) => ds.species[sp]?.name ?? '?';
  if (!groups.length) {
    return <div class="card small muted">Nothing to farm: every Pokémon here is done, still low level, or has unknown EVs.</div>;
  }
  const owned = ownedItems.value;
  const shop: { item: string; need: number }[] = [];
  for (const g of groups) {
    shop.push({ item: VITAMIN[g.stat], need: g.who.reduce((a, w) => a + Math.ceil(w.need / VITAMIN_EVS), 0) });
    shop.push({ item: POWER_ITEM[g.stat], need: 1 });
  }
  return (
    <>
      <div class="card">
        <p class="title">Farm sessions <span class="r">one stat at a time</span></p>
        {groups.map((g) => {
          const [lead, ...rest] = g.who;
          const acc = trainingAccounts(ds, g.stat)[0];
          const wild = wildEvSpots(ds, g.stat, 1)[0];
          const opt = (i: number, body: preact.ComponentChildren) => {
            const k = `${g.stat}:${i}`;
            return (
              <label class="farmopt small">
                <input type="checkbox" checked={ticks.includes(k)} onChange={() => toggle(k)} />
                <span>{body}</span>
              </label>
            );
          };
          return (
            <div class="farmgrp">
              <div class="row" style={{ justifyContent: 'space-between' }}>
                <b class="farmstat">{STAT_NAME[g.stat]}</b>
                <span class="small muted num">{g.total} EVs · {g.who.length} Pokémon</span>
              </div>
              <div class="chips">
                {g.who.map((w) => {
                  const reset = rows.find((r) => r.mon.uid === w.mon.uid)?.status.state === 'reset';
                  return <span class={`chip sm${reset ? ' warn' : ''}`} title={reset ? 'Lower its extra EVs first (see Box)' : undefined}>{name(w.mon.species)} +{w.need}{reset ? ' · lower first' : ''}</span>;
                })}
              </div>
              {opt(0, <>
                <b>Bring:</b> {name(lead.mon.species)} battles holding a <b>{POWER_ITEM[g.stat]}</b>
                {rest.length ? <>; {rest.map((w) => name(w.mon.species)).join(', ')} {rest.length > 1 ? 'hold' : 'holds'} an Exp. Share <span class="muted">(guess: same EVs)</span></> : null}
              </>)}
              {acc && opt(1, <>
                Training account <b>{acc.account.account}</b> (Player Battles, {acc.account.pokemon})
                {acc.amount ? `: about ${koCount(lead.need, acc.amount).power} wins for ${name(lead.mon.species)} with the ${POWER_ITEM[g.stat]}` : ''}
                <span class="muted"> (shared by players, unverified)</span>
              </>)}
              {wild && opt(2, <>
                Wild <b>{wild.name}</b> ({wild.amount} {STAT_NAME[g.stat]}, {wild.rarity.replace('-', ' ')}) in {wild.maps.slice(0, 2).join(', ')}: {koCount(lead.need, wild.amount).power} knockouts with the Power item
              </>)}
              {opt(3, <>Or top up: {g.who.map((w) => `${Math.ceil(w.need / VITAMIN_EVS)} ${VITAMIN[g.stat as StatKey]} for ${name(w.mon.species)}`).join(', ')}</>)}
            </div>
          );
        })}
      </div>
      <div class="card">
        <p class="title">Shopping list <span class="r">{bag.value ? 'vs your bag' : 'bag not read yet'}</span></p>
        <div class="shop small">
          <span class="h">Item</span><span class="h">Need</span><span class="h">Have</span>
          {shop.map((s) => {
            const have = owned.get(itemId(s.item)) ?? 0;
            return (
              <>
                <span>{s.item}</span>
                <span class="num">{s.need}</span>
                <span class="num" style={{ color: bag.value ? (have >= s.need ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>{bag.value ? `${have}${have >= s.need ? ' ✓' : ''}` : '?'}</span>
              </>
            );
          })}
        </div>
        <div class="small muted" style={{ marginTop: '4px' }}>Vitamins cover the whole gap; the Power item is one to share. {bag.value ? 'Bag from the last Bag page you opened.' : 'Open the Bag page in the game once to fill "Have".'}</div>
      </div>
    </>
  );
}
