import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Dataset } from '../../shared/types';

/** Type colours too light for white text get dark text instead. */
const LIGHT_TEXT = new Set(['Electric', 'Ice', 'Ground', 'Normal', 'Bug', 'Steel']);

export function typeColor(t: string) {
  return `var(--t-${t.toLowerCase()})`;
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span class={`type${LIGHT_TEXT.has(type) ? ' light' : ''}`} style={{ background: typeColor(type) }}>
      {type}
    </span>
  );
}

export function Types({ types }: { types: string[] }) {
  return (
    <>
      {types.map((t) => (
        <>
          {' '}
          <TypeBadge type={t} />
        </>
      ))}
    </>
  );
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Trainer portrait from the game's own static assets, falling back to initials. */
export function Avatar({ name, src }: { name: string; src?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class="av" aria-hidden="true">
      {src && !broken ? <img src={`https://pokemeowrpg.com${src}`} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
}

export function MoveChip({ ds, id }: { ds: Dataset; id: string }) {
  const m = ds.moves[id];
  if (!m) return <span class="mv">{id}</span>;
  return (
    <span class="mv" title={`${m.type} · ${m.category}${m.power ? ` · ${m.power} BP` : ''}${m.priority ? ` · priority ${m.priority > 0 ? '+' : ''}${m.priority}` : ''}\n${m.description}`}>
      <i style={{ background: typeColor(m.type) }} />
      {m.name}
      {m.category !== 'Status' && m.power ? <span class="pw">{m.power}</span> : null}
    </span>
  );
}

export function Tip({ kind = 'info', icon, children }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; icon?: string; children: ComponentChildren }) {
  return (
    <div class={`tip ${kind}`}>
      <span class="ic">{icon ?? (kind === 'info' ? 'i' : kind === 'ok' ? '✓' : '!')}</span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="ball" />
      <b>{title}</b>
      {children}
    </div>
  );
}

export function scoreClass(s: number) {
  return s >= 70 ? '' : s >= 45 ? 'm' : 'b';
}
