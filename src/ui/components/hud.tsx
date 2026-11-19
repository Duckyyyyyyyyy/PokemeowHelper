/** Arena HUD parts shared by Battle, Wild and Prep: icons, HP bar with their hit, plates, ratings, danger strip. */
import type { ComponentChildren } from 'preact';
import type { BattleMon, Boosts } from '../../shared/battle';
import type { Dataset } from '../../shared/types';
import { dangerOf, DANGER_LABEL, rate, speedLine } from '../../engine/plain';
import type { ThreatInfo } from '../../engine/turnAdvisor';
import { Types } from './common';

const PATHS: Record<string, string> = {
  battle: 'M4 20 15 9M14 4h6v6M20 4 9 15M4 14l6 6M3 21l3-3',
  wild: 'M5 19C5 11 11 5 19 5c0 8-6 14-14 14zM5 19l7-7',
  prep: 'M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 3h6v3H9zM8.5 11h7M8.5 15h5',
  guide: 'M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14',
  gear: 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  swap: 'M4 8h15l-3.5-3.5M20 16H5l3.5 3.5',
  bag: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18.5 3v4.3h-4.3M5.5 21v-4.3h4.3',
  x: 'M6 6l12 12M18 6 6 18',
  warn: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2v.1',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16',
};

export function Icon({ name, size = 18, stroke = 2.2 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number }) {
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export const hpPct = (hp?: number, max?: number) => (hp !== undefined && max ? Math.max(0, Math.min(100, (100 * hp) / max)) : undefined);

/**
 * HP bar. `ghost` = their best hit as [min%, max%] of max HP, drawn back from the end of the current HP:
 * solid stripes = their lowest roll, faint stripes = up to their highest. Covers the whole bar = KO range.
 */
export function Hp({ pct, ghost, label }: { pct?: number; ghost?: [number, number]; label?: string }) {
  if (pct === undefined) return null;
  const p = Math.round(pct);
  const lo = ghost ? Math.min(p, ghost[0]) : 0;
  const hi = ghost ? Math.min(p, ghost[1]) : 0;
  return (
    <span class="hp" role="meter" aria-label={label ?? 'HP'} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <i class={p > 50 ? 'g' : p > 20 ? 'y' : 'r'} style={{ width: `${p}%` }} />
      {ghost && hi > lo && <b class="gh hi" style={{ left: `${p - hi}%`, width: `${hi - lo}%` }} />}
      {ghost && lo > 0 && <b class="gh lo" style={{ left: `${p - lo}%`, width: `${lo}%` }} />}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = { par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRZ' };
const BOOST_LABEL: Record<string, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' };

export function speciesTypes(ds: Dataset, name: string): string[] {
  const s = Object.values(ds.species).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return s?.types ?? [];
}

export function initials(name: string) {
  return name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
}

/** Avatar: initials on the first type's colour, the second type as a band at the bottom. */
export function TypeAvatar({ name, types, size = 36 }: { name: string; types: string[]; size?: number }) {
  const a = types[0]?.toLowerCase();
  const b = (types[1] ?? types[0])?.toLowerCase();
  const white = ['fighting', 'poison', 'ghost', 'dragon', 'dark'].includes(a ?? '');
  return (
    <span class="av" aria-hidden="true" style={{
      width: `${size}px`, height: `${size}px`, border: 0,
      background: a ? `linear-gradient(var(--t-${a}) 0 66%, var(--t-${b}) 66%)` : undefined,
      color: a ? (white ? '#fff' : '#10141F') : undefined,
    }}>{initials(name)}</span>
  );
}

/** One side of the battle, like the game's name plate. `threat` draws their hit on your HP bar. */
export function Plate({ ds, mon, boosts, foe, threat, small, children }: {
  ds: Dataset; mon: BattleMon; boosts?: Boosts; foe?: boolean; threat?: ThreatInfo; small?: boolean; children?: ComponentChildren;
}) {
  const types = speciesTypes(ds, mon.name);
  const pct = hpPct(mon.hp, mon.maxHp);
  const stages = Object.entries(boosts ?? mon.stages ?? {}).filter(([, v]) => v);
  const ko = !!threat && threat.ko === 'sure';
  return (
    <div class={`plate${foe ? ' foe' : ' me'}${small ? ' sm' : ''}${ko ? ' ko' : ''}`}>
      <TypeAvatar name={mon.name} types={types} size={small ? 30 : 38} />
      <div class="pm">
        <div class="pn">
          <b>{mon.name}</b><span class="lv">Lv {mon.level ?? '?'}</span>
          {!small && <Types types={types} />}
          {mon.status && <span class={`st ${mon.status}`}>{STATUS_LABEL[mon.status] ?? mon.status}</span>}
          {stages.map(([k, v]) => <span class={`bo${v! > 0 ? ' up' : ''}`}>{BOOST_LABEL[k] ?? k} {v! > 0 ? `+${v}` : v}</span>)}
        </div>
        <Hp pct={pct} ghost={threat ? [threat.minPct, threat.maxPct] : undefined} label={`${mon.name} HP`} />
        <div class="pf">
          <span>{mon.hp ?? '?'}/{mon.maxHp ?? '?'}{mon.item ? <span class="item"> · {mon.item}</span> : null}</span>
          {threat && <span class="hit">{ko ? 'KO range · ' : ''}{threat.name} −{Math.round(threat.minPct)}–{Math.round(threat.maxPct)}%</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function RatePill({ score, top, unknown, calcError, cls = 'pill' }: { score: number | null | undefined; top?: number | null; unknown?: boolean; calcError?: boolean; cls?: string }) {
  const r = calcError ? { label: 'Calc error', tone: 'calc' } : unknown ? { label: 'Moves ?', tone: 'none' } : rate(score, top);
  return <span class={`${cls} ${r.tone}`}>{r.label}</span>;
}

const pctTxt = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

/** Safe / Watch / KO risk, with their best move and who moves first. */
export function DangerStrip({ threat }: { threat?: ThreatInfo }) {
  if (!threat) return null;
  const d = dangerOf(threat);
  const lvl = d === 'safe' ? 1 : d === 'watch' ? 2 : 3;
  const extra = d !== 'ko' && (threat.critKo ?? 0) >= 0.01 ? ` Crit KO ${pctTxt(threat.critKo!)}.` : d === 'watch' && threat.ko !== 'chance' && (threat.koChance ?? 0) >= 0.01 ? ` ~${pctTxt(threat.koChance!)} they KO you.` : '';
  const text = d === 'ko' ? `Their ${threat.name} KOs you.` : threat.ko === 'chance' ? `Their ${threat.name} can KO you.` : `You survive their ${threat.name}.`;
  return (
    <div class={`danger ${d}`} role="status">
      <span class="lvl">{DANGER_LABEL[d]}</span>
      <span class="grow">{text} {speedLine(threat.youFirst)}.{extra}{threat.calcError && <span class="chip warn sm" style={{ marginLeft: '4px' }} title="The damage calc failed for some of their moves: this may not be their best hit.">calc error</span>}</span>
      <span class="meter" aria-hidden="true"><i class="on" /><i class={lvl >= 2 ? 'on' : ''} /><i class={lvl >= 3 ? 'on' : ''} /></span>
    </div>
  );
}

/** Folded section ("Details", "Battle log"…). */
export function Fold({ title, open, children }: { title: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="fold" open={open}>
      <summary>{title}</summary>
      <div class="in">{children}</div>
    </details>
  );
}
