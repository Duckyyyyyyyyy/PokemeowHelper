import { useEffect, useMemo, useState } from 'preact/hooks';
import type { BoxMon, Dataset, Species } from '../../shared/types';
import { box, dataset, goPrep, selectedNpc, selectedVariant, setBox } from '../store';
import { Empty, MoveChip, Tip, Types } from '../components/common';
import { hardestFoes, outcomeOf, suggestTeam, supportLead, type Candidate } from '../../engine/teamSuggest';
import { RatePill, TypeAvatar } from '../components/hud';
import { HuntCard } from '../components/HuntCard';
import { formatMult } from '../../engine/typeChart';
import { NoData } from './shared';
import { BoxSyncCard } from '../components/BoxSync';
import { DuelDetail, MovesetPanel, duelSummary } from '../components/DamageViews';
import { dsFor, rulesFor } from '../../engine/rules';
import { facilityOf, frontierEntry, itemClause } from '../../engine/frontier';
import { gen3Item } from '../../engine/gen3';
import { towerEndurance } from '../../engine/towerPlan';
import { LevelModeSeg } from '../components/FacilityRules';
import { frontierVariant, levelMode } from '../frontierPrefs';
import { excludedUids, lockedUids, resetTeamPrefs, teamToText, toggleExclude, toggleLock } from '../teamPrefs';
import { assignHeldItems, suggestHeldItems } from '../../engine/heldItems';
import { bag, ownedItems, ownedTms } from '../bagStore';
import { GrindCard } from '../components/GrindCard';
import { worthGrinding } from '../../engine/potential';
import { activeBossMoves, bossLobby, bossPicks } from '../bossStore';
import { bossVariant, isWorldBoss } from '../../engine/worldBoss';
import { BossCounter } from '../components/WorldBoss';
import { leadPairs } from '../../engine/leadPairs';
import { boxToShowdown, npcToShowdown, toShowdownTeam } from '../../engine/showdownExport';
import { SimExport } from '../components/SimExport';

/** Battle Frontier entry problems: who can't enter, what changes under Gen III rules, item clause. */
function FrontierNotes({ ds, team, entries, blocked, ownTeam }: { ds: Dataset; team: BoxMon[]; entries: Map<string, { blocking: string[]; notes: string[] }>; blocked: string[]; ownTeam: boolean }) {
  const dupItems = itemClause(ds, team);
  const notes = team.flatMap((m) => (entries.get(m.uid)?.notes ?? []).map((n) => `${ds.species[m.species]?.name ?? '?'}: ${n}`));
  return (
    <Tip kind={dupItems.length || notes.length ? 'warn' : 'info'}>
      {!ownTeam && <div>This facility uses rental Pokémon: the suggestion below is only a reference.</div>}
      {blocked.length > 0 && <div><b>Can't enter ({blocked.length}):</b> {blocked.slice(0, 4).join('; ')}{blocked.length > 4 ? '…' : ''}</div>}
      {dupItems.length > 0 && <div><b>Item clause:</b> {dupItems.join(', ')} is held twice; only one of each item can enter.</div>}
      {notes.slice(0, 6).map((n) => <div>{n}</div>)}
      <div class="bad-t">Hardcore runs: your own Pokémon that faint in the Frontier are lost for good.</div>
    </Tip>
  );
}

/** Prep → Team (the suggestion, your box) or Prep → Hunt & grind (Worth grinding + the Hunt slot). */
export function TeamTab({ part = 'team' }: { part?: 'team' | 'hunt' }) {
  const ds = dataset.value;
  if (!ds) return <NoData />;
  return (
    <>
      <Suggestion ds={ds} part={part} />
      {part === 'team' && <BoxSyncCard compact />}
      {part === 'team' && <BoxEditor ds={ds} />}
    </>
  );
}

/* ---------------- suggestion ---------------- */

function Suggestion({ ds: base, part }: { ds: Dataset; part: 'team' | 'hunt' }) {
  const npc = selectedNpc.value;
  const v0 = npc ? npc.variants[Math.min(selectedVariant.value, npc.variants.length - 1)] : null;
  const rules = rulesFor(npc?.category);
  // Battle Frontier: Gen III data, the Brain's real level, eligibility, 3-Pokémon teams and clauses.
  const ds = dsFor(base, rules);
  const facility = facilityOf(npc);
  const mode = levelMode.value;
  const fr = useMemo(() => (npc && v0 && facility ? frontierVariant(base, box.value, npc, v0, mode) : null), [base, box.value, npc, v0, mode]);
  // World Boss: only this spawn's moves (World Boss page or your pick in Prep).
  const bossSel = npc && isWorldBoss(npc) ? activeBossMoves(base, npc, bossLobby.value, bossPicks.value) : null;
  const vRaw = fr?.v ?? v0;
  const bossIds = bossSel?.ids.join(',');
  const v = useMemo(() => (vRaw && bossSel ? bossVariant(vRaw, bossSel.ids) : vRaw), [vRaw, bossIds]);
  const entries = useMemo(
    () => (facility ? new Map(box.value.map((m) => [m.uid, frontierEntry(base, m, facility, mode)])) : null),
    [base, box.value, facility, mode],
  );
  const tower = npc?.category === 'tower';
  const locked = lockedUids.value;
  const excluded = excludedUids.value;
  const res = useMemo(() => {
    if (!v) return null;
    const blocked = entries ? new Map([...entries].filter(([, e]) => e.blocking.length).map(([uid, e]) => [uid, e.blocking[0]])) : undefined;
    // Pyramid: registered without held items, so score them without one.
    const mons = facility && !facility.heldItems ? box.value.map((m) => ({ ...m, item: null })) : box.value;
    return suggestTeam(ds, mons, v, { levelCap: v.levelCap, rules, locked, excluded, blocked, uniqueSpecies: !!facility, size: facility?.register });
  }, [ds, v, box.value, npc, locked, excluded, entries]);
  // Frontier: Pokémon that can never enter stay out of the grind plan too.
  const grindExcluded = useMemo(
    () => (entries ? [...excluded, ...[...entries].filter(([, e]) => e.blocking.length).map(([uid]) => uid)] : excluded),
    [entries, excluded],
  );
  // Worth grinding, once for both cards (Hunt compares against it). Only on the Hunt & grind step.
  const tms = ownedTms.value;
  const grind = useMemo(
    () => (res && v && part === 'hunt' ? worthGrinding(ds, v, res, { levelCap: v.levelCap, rules, locked, excluded: grindExcluded, ownedTms: tms, size: facility?.register }) : null),
    [ds, v, res, part, tms, grindExcluded, facility],
  );
  const endurance = useMemo(() => (tower && res && v ? towerEndurance(res.team, v) : null), [tower, res, v]);
  const allOwned = ownedItems.value;
  // Frontier: only Gen III held items (none at all in the Pyramid).
  const owned = useMemo(
    () => (facility ? new Map([...allOwned].filter(([id]) => facility.heldItems && !!gen3Item(id))) : allOwned),
    [allOwned, facility],
  );
  // One held item per team member from your bag (needs the Bag page read once).
  const held = useMemo(() => {
    if (!res || !v || !bag.value) return null;
    const per = res.team.map((c) => ({ uid: c.mon.uid, tips: suggestHeldItems(ds, c.mon, v, owned, { levelCap: v.levelCap, rules }) }));
    return assignHeldItems(per, owned);
  }, [ds, res, v, owned]);
  // Phase 4a: support moves worth using against the NPC's lead (team members only, singles).
  const leads = useMemo(() => {
    if (!res || !v) return null;
    return new Map(res.team.map((c) => [c.mon.uid, supportLead(ds, c.mon, v, { levelCap: v.levelCap, rules })]));
  }, [ds, res, v]);
  // Phase 4b: doubles NPCs open with two Pokémon, so rate lead PAIRS.
  const pairs = useMemo(() => (res && v?.format === 'doubles' ? leadPairs(ds, res.team, v, v.levelCap) : []), [ds, res, v]);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setCopied(null), [res]); // the copied text belongs to the old team
  const bench = res ? res.ranked.filter((c) => c.eligible && !res.team.includes(c)) : [];
  const lockedOut = res ? res.ranked.filter((c) => c.locked && !res.team.includes(c)) : [];

  async function exportTeam() {
    if (!res || !npc || !v) return;
    const text = teamToText(base, res.team.map((c) => c.mon), `MeowRPGAdvisor team vs ${v.trainerName ?? npc.name}${npc.variants.length > 1 ? ` (${v.label})` : ''}`);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Team copied to the clipboard.');
    } catch {
      setCopied(text); // shown in a box to copy by hand
    }
  }
  const name = (c: Candidate) => ds.species[c.mon.species]?.name ?? '?';
  const [cell, setCell] = useState<{ j: number; uid: string } | null>(null);
  const [movesFor, setMovesFor] = useState<string | null>(null);
  const [allRows, setAllRows] = useState(false);

  return (
    <>
      <div class="card row">
        <div class="grow">
          <div class="title" style={{ margin: 0 }}>Opponent</div>
          <b>{npc ? `${v!.trainerName ?? npc.name}${npc.variants.length > 1 ? ` · ${v!.label}` : ''}` : 'No NPC selected'}</b>
          {v && <div class="small muted">{facility ? `${facility.name} · Gen III rules · register ${facility.register}` : tower ? `One battle vs ${v.team.length} · HP/PP carry over · bring up to 6` : `${v.format === 'doubles' ? 'Doubles' : 'Singles'} · ${v.levelCap ? `Cap Lv ${v.levelCap}` : 'No level cap'}`}</div>}
        </div>
        <button class="btn sm" onClick={() => goPrep('npc')}>{npc ? 'Change' : 'Pick NPC'}</button>
      </div>

      {!npc || !v ? (
        <Tip>Pick an NPC in step 1 (Opponent), then tap “Suggest team”.</Tip>
      ) : !box.value.length ? (
        <Tip>Add the Pokémon you own to “Your box” below to get suggestions.</Tip>
      ) : res && grind && part === 'hunt' ? (
        !(facility && mode === 'open') ? (
          <>
            <HuntCard ds={ds} npc={npc} v={v} ready={res} grind={grind} rules={rules} size={facility?.register} />
            <GrindCard ds={ds} v={v} grind={grind} />
          </>
        ) : <Tip>Open Level Brains scale to your highest level, so catching and grinding gain nothing here.</Tip>
      ) : res && isWorldBoss(npc) ? (
        // World Boss: a damage race vs one shared HP pool, not 1v1 wins (the 1v1 grid would say "loses" to everything).
        <>
          {!bossSel && <Tip kind="warn">Counting the boss's whole move pool. Pick this spawn's moves in step 1 (Opponent), or open its details on the game's World Boss page.</Tip>}
          <BossCounter ds={ds} npc={npc} v={v} />
        </>
      ) : res && (
        <>
          {fr && <LevelModeSeg level={fr.level} estimated={fr.estimated} />}
          {facility && entries && <FrontierNotes ds={base} team={res.team.map((c) => c.mon)} entries={entries} blocked={res.ranked.filter((c) => entries.get(c.mon.uid)?.blocking.length).map((c) => `${name(c)} (${entries.get(c.mon.uid)!.blocking[0]})`)} ownTeam={facility.ownTeam} />}
          {endurance && (
            <Tip kind={endurance.total > endurance.budget || endurance.losses ? 'warn' : 'ok'}>
              <b>Endurance:</b> answering each of the {v!.team.length} with its best counter costs about {endurance.total}% HP of the team's {endurance.budget}%
              {endurance.losses ? ` and ${endurance.losses} have no 1v1 answer` : ''}. Per Pokémon: {res.team.map((c, i) => `${name(c)} ${endurance.spent[i]}%`).join(', ')}.
              <div class="small muted">Rough: ignores healing (Leftovers, recovery), switch-in damage, status and PP. Scores here favour HP kept and sustain, since nothing heals between opponents.</div>
            </Tip>
          )}
          <div class="card">
            <p class="title">Bring these {res.team.length} · ready now <span class="r">{(() => { const n = v.team.filter((_, j) => res.team.some((c) => c.pairs[j] && outcomeOf(c.pairs[j], tower) === 'win')).length; return `answers ${n} of ${v.team.length}`; })()}</span></p>
            {res.team.map((c) => {
              const s = ds.species[c.mon.species];
              const bi = c.pairs.reduce((a, p, i) => ((p.duel?.mine?.expectedPct ?? 0) > (c.pairs[a].duel?.mine?.expectedPct ?? 0) ? i : a), 0);
              const best = c.pairs[bi]?.duel?.mine;
              const wins = c.pairs.filter((p) => p.duel?.win).length;
              return (
                <div class="mon">
                  <TypeAvatar name={s?.name ?? '?'} types={s?.types ?? []} size={34} />
                  <span class="nm">{s?.name}{res.lead === c && v.format !== 'doubles' ? <> <span class="lead">LEAD</span></> : null}<Types types={s?.types ?? []} /></span>
                  <span class="row">
                    <RatePill score={c.avg} />
                    <button class={`btn sm${c.locked ? ' primary' : ''}`} onClick={() => toggleLock(c.mon.uid)} aria-pressed={!!c.locked}
                      title={c.locked ? 'Locked: always on the team. Tap to unlock.' : 'Lock this slot'} aria-label={`${c.locked ? 'Unlock' : 'Lock'} ${s?.name}`}>{c.locked ? 'Locked' : 'Lock'}</button>
                    <button class="btn sm" onClick={() => toggleExclude(c.mon.uid)} title="Don't suggest this Pokémon" aria-label={`Exclude ${s?.name}`}>✕</button>
                  </span>
                  <div class="full small muted">
                    {c.mon.level ? `Lv ${c.mon.level} · ` : ''}Wins {wins}/{v.team.length} 1v1
                    {best ? ` · Best: ${best.name} ${Math.round(best.minPct)}–${Math.round(best.maxPct)}% on ${v.team[bi]?.name}` : ' · No damaging move'}
                  </div>
                  {leads?.get(c.mon.uid) && (() => {
                    const l = leads.get(c.mon.uid)!;
                    return (
                      <div class="full small" title={l.reason}>
                        <span class="chip" style={{ padding: '0 7px' }}>{l.title}</span> <b>{l.moveName}</b> vs {v.team[0]?.name}: <span class="muted">{l.reason}</span>
                      </div>
                    );
                  })()}
                  {held && (
                    <div class="full small">
                      {held.get(c.mon.uid) ? (
                        <>🎒 Hold <b>{held.get(c.mon.uid)!.name}</b>: <span class="muted">{held.get(c.mon.uid)!.why}{c.mon.item && c.mon.item !== held.get(c.mon.uid)!.name ? ` (now holds ${c.mon.item})` : ''}</span></>
                      ) : <span class="muted">🎒 No item in your bag helps much here{c.mon.item ? ` (keep ${c.mon.item})` : ''}.</span>}
                    </div>
                  )}
                  <div class="full">
                    <button class="link small" onClick={() => setMovesFor(movesFor === c.mon.uid ? null : c.mon.uid)} aria-expanded={movesFor === c.mon.uid}>
                      {movesFor === c.mon.uid ? 'Hide move advice' : 'Best moves for this fight →'}
                    </button>
                  </div>
                  {movesFor === c.mon.uid && <div class="full"><MovesetPanel ds={ds} mon={c.mon} v={v} rules={rules} /></div>}
                </div>
              );
            })}
            {!res.team.length && <div class="small muted">No eligible Pokémon (check the level cap).</div>}
            {res.team.length > 0 && (
              <div class="btns" style={{ marginTop: '8px' }}>
                <button class="btn primary" onClick={exportTeam}>Copy team</button>
                {(locked.length > 0 || excluded.length > 0) && (
                  <button class="btn" onClick={resetTeamPrefs} title="Clear every lock and exclusion">Reset locks ({locked.length + excluded.length})</button>
                )}
              </div>
            )}
            {copied && (copied.startsWith('//') ? (
              <textarea class="input" style={{ width: '100%', height: '120px', marginTop: '6px' }} readOnly value={copied} aria-label="Team text to copy" />
            ) : <div class="small muted" role="status" style={{ marginTop: '4px' }}>{copied}</div>)}
            <div class="small muted" style={{ marginTop: '4px' }}>Lock keeps a Pokémon on the team · ✕ never suggests it · tap a bench name to lock it in.</div>
            <div class="small muted">{held ? '🎒 Held items: from your bag, one each. Damage items use the calc; the rest are rules of thumb.' : '🎒 Open your Bag page in the game once to get held item advice from what you own.'}</div>
          </div>
          {lockedOut.length > 0 && (
            <Tip kind="warn">Locked but not on the team: {lockedOut.map((c) => `${name(c)} (${c.reason ?? 'team is full'})`).join(', ')}</Tip>
          )}
          {res.team.length > 0 && (
            <SimExport
              mine={toShowdownTeam(res.team.map((c) => boxToShowdown(ds, c.mon, v.levelCap ?? 50)))}
              foe={toShowdownTeam(v.team.map((m) => npcToShowdown(ds, m)))}
              mineLabel="Copy my team" foeLabel="Copy NPC team"
            />
          )}


          {res.team.length > 0 && (() => {
            // Big rosters (Battle Tower: 20): hardest NPC Pokémon first, top 8, unless you ask for all.
            const big = v.team.length > 8;
            const order = big ? hardestFoes(res.team, v.team.length, tower).map((r) => r.index) : v.team.map((_, j) => j);
            const rowsShown = big && !allRows ? order.slice(0, 8) : order;
            return (
            <div class="card">
              <p class="title">{big ? `Hardest for your team · ${rowsShown.length} of ${v.team.length}` : 'Matchups'}<span class="r">✓ wins · ~ close · ✗ loses</span></p>
              {/* Rows = NPC Pokémon, columns = your team (max 6). Symbols instead of raw scores. */}
              <div class="mx" style={{ gridTemplateColumns: `minmax(70px, 1.4fr) repeat(${res.team.length}, minmax(30px, 1fr))` }}>
                <span class="h" style={{ textAlign: 'left' }}>Them ↓ You →</span>
                {res.team.map((c) => <span class="h" title={name(c)}>{name(c).slice(0, 6)}</span>)}
                {rowsShown.map((j) => {
                  const m = v.team[j];
                  return (
                    <>
                      <span class="rn" title={m.name}>{m.name}</span>
                      {res.team.map((c) => {
                        const p = c.pairs[j];
                        const o = outcomeOf(p, tower);
                        return (
                          <button
                            class={`c ${o === 'win' ? 'w' : o === 'close' ? 'e' : 'l'}${cell?.j === j && cell.uid === c.mon.uid ? ' sel' : ''}`}
                            title={p.duel ? `${name(c)} vs ${m.name}: ${duelSummary(p.duel)}` : `${name(c)} vs ${m.name}: deals ${formatMult(p.bestHit.mult)}`}
                            aria-label={`${name(c)} vs ${m.name}: ${o === 'win' ? 'wins' : o === 'close' ? 'close' : 'loses'}`}
                            onClick={() => setCell(cell?.j === j && cell.uid === c.mon.uid ? null : { j, uid: c.mon.uid })}
                          >
                            {o === 'win' ? '✓' : o === 'close' ? '~' : '✗'}
                          </button>
                        );
                      })}
                    </>
                  );
                })}
              </div>
              {big && <button class="link small" style={{ marginTop: '6px' }} onClick={() => setAllRows(!allRows)}>{allRows ? 'Show the 8 hardest' : `Show all ${v.team.length}`}</button>}
              <div class="small muted" style={{ marginTop: '6px' }}>Tap a cell for the damage numbers.{tower ? ' Tower: "wins" also counts the HP it keeps, since nothing heals between opponents.' : ''}</div>
              {cell && (() => {
                const c = res.team.find((t) => t.mon.uid === cell.uid);
                const p = c?.pairs[cell.j];
                return c && p?.duel ? <DuelDetail ds={ds} you={c.mon} foeName={v.team[cell.j].name} d={p.duel} /> : null;
              })()}
            </div>
            );
          })()}

          {pairs.length > 0 && (
            <div class="card">
              <p class="title">Lead pair · Doubles <span class="r small muted">vs {v.team.slice(0, 2).map((m) => m.name).join(' + ')}</span></p>
              {pairs.map((p, i) => (
                <div class={`act${i === 0 ? ' top' : ''}`}>
                  <RatePill score={p.score} top={pairs[0]?.score} />
                  <div class="grow">
                    <b>{name(p.a)} + {name(p.b)}</b>
                    <div class="small muted">{p.why.length ? p.why.join(' · ') : 'No special teamwork found.'}</div>
                  </div>
                </div>
              ))}
              <div class="small muted" style={{ marginTop: '4px' }}>Score = how well the pair answers both NPC leads (1v1 view) + teamwork rules of thumb (spread moves vs your partner, Fake Out, Follow Me, Helping Hand, Tailwind / Trick Room, KO together).</div>
            </div>
          )}
          {res.lead && v.format !== 'doubles' && (
            <Tip kind="info">
              Lead with <b>{name(res.lead)}</b>: {outcomeOf(res.lead.pairs[0], tower) === 'win' ? 'it beats' : outcomeOf(res.lead.pairs[0], tower) === 'close' ? 'it is close against' : 'your best answer to'} their first Pokémon ({v.team[0]?.name}).
            </Tip>
          )}
          {bench.length > 0 && (
            <div class="small muted">
              Bench:{' '}
              {bench.slice(0, 10).map((c, i) => (
                <>{i > 0 && ', '}<button class="link small" onClick={() => toggleLock(c.mon.uid)} title={`Lock ${name(c)} into the team (${c.avg})`}>{name(c)}</button></>
              ))}
              {bench.length > 10 && ` +${bench.length - 10} more`}
            </div>
          )}
          {v.format === 'doubles' && res.team.length < 2 && (
            <Tip kind="warn">Doubles battles need at least 2 eligible Pokémon.</Tip>
          )}
          {res.ranked.some((c) => !c.eligible) && (
            <Tip kind="warn">
              Not used:{' '}
              {res.ranked.filter((c) => !c.eligible).map((c, i) => (
                <>{i > 0 && ', '}{name(c)} ({c.reason})
                  {excluded.includes(c.mon.uid) && <> <button class="link small" onClick={() => toggleExclude(c.mon.uid)}>undo</button></>}</>
              ))}
            </Tip>
          )}
          {rules.npcIgnoresWonderGuard && <div class="small muted">World Boss / Mega Chamber rules applied: your banned moves score 0 and their attacks ignore Wonder Guard.</div>}
          <div class="foot">Damage via Gen 9 formulas with real stats, moves, abilities and items. 1v1 estimate: both sides use their best move each turn (no switching, crits or healing).</div>
        </>
      )}
    </>
  );
}

/* ---------------- box editor ---------------- */

function BoxEditor({ ds }: { ds: Dataset }) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(12);
  const speciesList = useMemo(() => Object.values(ds.species).sort((a, b) => a.name.localeCompare(b.name)), [ds]);
  const byName = useMemo(() => new Map(speciesList.map((s) => [s.name.toLowerCase(), s])), [speciesList]);

  function add(e: Event) {
    e.preventDefault();
    const s = byName.get(name.trim().toLowerCase());
    if (!s) {
      setErr('Pokémon not found – pick one from the list.');
      return;
    }
    const lv = level ? Math.max(1, Math.min(120, parseInt(level, 10) || 0)) : undefined;
    setBox([...box.value, { uid: crypto.randomUUID(), species: s.id, level: lv, moves: [], source: 'manual' }]);
    setName('');
    setLevel('');
    setErr('');
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? box.value.filter((b) => {
        const s = ds.species[b.species];
        return [s?.name, ...(s?.types ?? []), ...b.moves.map((id) => ds.moves[id]?.name)].join(' ').toLowerCase().includes(needle);
      })
    : box.value;

  const update = (uid: string, patch: Partial<BoxMon>) => setBox(box.value.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  const remove = (uid: string) => setBox(box.value.filter((b) => b.uid !== uid));

  return (
    <div class="card">
      <p class="title">Your box <span class="r">{box.value.length} Pokémon</span></p>
      <form class="row" onSubmit={add}>
        <input class="input grow" list="md-species" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Pokémon name" aria-label="Pokémon name" />
        <input class="input" style={{ width: '62px' }} inputMode="numeric" value={level} onInput={(e) => setLevel(e.currentTarget.value)} placeholder="Lv" aria-label="Level" />
        <button class="btn sm primary" type="submit">Add</button>
      </form>
      <datalist id="md-species">{speciesList.map((s) => <option value={s.name} />)}</datalist>
      {err && <div class="small" style={{ color: 'var(--red)', marginTop: '4px' }}>{err}</div>}

      {!box.value.length && <Empty title="Your box is empty">Sync your box from the game above, or add Pokémon by hand (level and moves are optional).</Empty>}
      {box.value.length > 12 && (
        <input class="input" style={{ width: '100%', marginTop: '8px' }} value={filter} onInput={(e) => { setFilter(e.currentTarget.value); setLimit(12); }} placeholder={`Filter ${box.value.length} Pokémon…`} aria-label="Filter your box" />
      )}
      {shown.slice(0, limit).map((b) => {
        const s = ds.species[b.species];
        const fromGame = b.source === 'game';
        const itemName = b.item ? ds.items[b.item]?.name ?? b.item : null;
        return (
          <div class="mon">
            <div class="av">{s?.name.slice(0, 2).toUpperCase()}</div>
            <span class="nm">{s?.name ?? '?'}<Types types={s?.types ?? []} /></span>
            <span class="row">
              <span class="lv">{b.level ? `Lv ${b.level}` : 'Lv ?'}</span>
              {fromGame ? (
                <span class="chip" title="Synced from the game – changes on the next sync">game</span>
              ) : (
                <>
                  <button class="btn sm" onClick={() => setEditing(editing === b.uid ? null : b.uid)} aria-expanded={editing === b.uid} aria-label={`Edit ${s?.name}`}>✎</button>
                  <button class="btn sm" onClick={() => remove(b.uid)} aria-label={`Remove ${s?.name}`}>✕</button>
                </>
              )}
            </span>
            <div class="full">
              {b.moves.length ? b.moves.map((id) => <MoveChip ds={ds} id={id} />) : <span class="small muted">No moves entered – using STAB types.</span>}
            </div>
            {fromGame && (b.ability || itemName || b.nature) && (
              <div class="full small muted">{[b.ability, itemName && `@ ${itemName}`, b.nature].filter(Boolean).join(' · ')}</div>
            )}
            {editing === b.uid && s && <MoveEditor ds={ds} s={s} mon={b} onChange={(p) => update(b.uid, p)} />}
          </div>
        );
      })}
      {shown.length > limit && <button class="btn" style={{ width: '100%', marginTop: '8px' }} onClick={() => setLimit(limit + 24)}>Show more ({shown.length - limit})</button>}
      {needle && !shown.length && <div class="small muted" style={{ marginTop: '6px' }}>No Pokémon match “{filter}”.</div>}
    </div>
  );
}

function MoveEditor({ ds, s, mon, onChange }: { ds: Dataset; s: Species; mon: BoxMon; onChange: (p: Partial<BoxMon>) => void }) {
  const learnable = useMemo(() => {
    const ids = new Set([...s.levelMoves.map(([id]) => id), ...s.machineMoves, ...s.eggMoves]);
    return [...ids].map((id) => ds.moves[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [ds, s]);
  const byName = new Map(learnable.map((m) => [m.name.toLowerCase(), m.id]));
  const listId = `md-moves-${mon.uid}`;
  const slots = [0, 1, 2, 3];

  return (
    <div class="full" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' }}>
      <datalist id={listId}>{learnable.map((m) => <option value={m.name}>{m.type} · {m.category}</option>)}</datalist>
      {slots.map((i) => (
        <input
          class="input"
          list={listId}
          aria-label={`Move ${i + 1}`}
          placeholder={`Move ${i + 1}`}
          value={ds.moves[mon.moves[i]]?.name ?? ''}
          onChange={(e) => {
            const id = byName.get(e.currentTarget.value.trim().toLowerCase());
            const next = [...mon.moves];
            if (id) next[i] = id;
            else next.splice(i, 1);
            onChange({ moves: next.filter(Boolean).slice(0, 4) });
          }}
        />
      ))}
      <label class="small muted" style={{ gridColumn: '1 / 3' }}>
        Level:{' '}
        <input class="input" style={{ width: '70px' }} inputMode="numeric" value={mon.level ?? ''} onChange={(e) => {
          const n = parseInt(e.currentTarget.value, 10);
          onChange({ level: Number.isFinite(n) ? Math.max(1, Math.min(120, n)) : undefined });
        }} />
        {' '}· Only moves this Pokémon can learn are suggested (level, TM, egg).
      </label>
    </div>
  );
}
