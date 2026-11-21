import { useMemo, useState } from 'preact/hooks';
import type { Dataset, Npc, NpcTeamVariant } from '../../shared/types';
import type { BattleRules } from '../../engine/rules';
import type { Suggestion } from '../../engine/teamSuggest';
import { targetLevel, type GrindTeam } from '../../engine/potential';
import { huntBall, huntFor, knownGear, passedStage, type HuntPick } from '../../engine/hunt';
import { METHOD_LABEL, RARITY_LABEL } from '../../engine/explore';
import { allTips } from '../../engine/tips';
import { bag, ownedItems } from '../bagStore';
import { box } from '../store';
import { doneTips, openTip } from '../tipsStore';
import { hunt, onHuntList, seenMaps, toggleHunt } from '../huntStore';
import { MoveChip, Tip, Types, scoreClass } from './common';

const pct = (x: number) => (x >= 0.0995 ? `${Math.round(x * 100)}%` : x >= 0.001 ? `${(x * 100).toFixed(1)}%` : x > 0 ? '<0.1%' : '–');
const ACCESS_LABEL = { seen: 'seen in Explore', ticked: 'ticked in Tips', open: '', guess: 'reachable? (guess)', locked: 'locked' } as const;

/**
 * "Hunt for <NPC>": wild Pokémon on maps you can (probably) reach that would beat a grind-team
 * member or answer an NPC Pokémon nobody in your box handles. Advice only.
 */
export function HuntCard({ ds, npc, v, ready, grind, rules, size }: {
  ds: Dataset;
  npc: Npc;
  v: NpcTeamVariant;
  ready: Suggestion;
  grind: GrindTeam;
  rules: BattleRules;
  size?: number;
}) {
  const npcName = v.trainerName ?? npc.name;
  const [showLocked, setShowLocked] = useState(false);
  const done = doneTips.value;
  const seen = seenMaps.value;
  const items = ownedItems.value;
  const res = useMemo(() => {
    const doneSet = new Set(done);
    const gear = knownGear(doneSet, new Set(items.keys()), box.value);
    return huntFor(ds, v, box.value, ready, grind, {
      levelCap: v.levelCap, rules, size, showLocked,
      progress: { tips: allTips(ds), done: doneSet, seenMaps: seen, passed: passedStage(npc) }, gear,
    });
  }, [ds, v, ready, grind, rules, size, showLocked, done, seen, items, npc]);
  const listed = hunt.value.list.filter((e) => e.npcId === npc.id);

  if (!ds.wild) return <Tip>Hunt for {npcName}: sync the data again in ⚙ Settings to load the explore maps.</Tip>;
  return (
    <div class="card">
      <p class="title">Hunt for {npcName} <span class="r">catch &amp; train to Lv {targetLevel(v)}</span></p>
      {res.covered ? (
        <Tip kind="ok">Your box already covers {npcName}: every Pokémon of theirs has an answer, now or after grinding.{res.picks.length ? ' These could still replace a weaker grind pick:' : ''}</Tip>
      ) : (
        <div class="small">Nobody in your box answers <b>{res.gaps.join(', ')}</b>.</div>
      )}
      {res.picks.map((p) => <HuntRow ds={ds} p={p} npc={npc} npcName={npcName} />)}
      {!res.covered && !res.picks.length && <div class="small muted">No wild Pokémon on the maps you can reach answers them{res.lockedForms ? '; try the locked maps' : ''}.</div>}
      <label class="small row" style={{ gap: '6px', marginTop: '6px' }}>
        <input type="checkbox" checked={showLocked} onChange={(e) => setShowLocked((e.target as HTMLInputElement).checked)} />
        Show locked maps{!showLocked && res.lockedForms ? ` (${res.lockedForms} more Pokémon)` : ''}
      </label>
      {listed.length > 0 && (
        <div class="small" style={{ marginTop: '4px' }}>
          Hunt list for {npcName}:{' '}
          {listed.map((e, i) => (
            <>{i > 0 && ', '}{ds.species[e.species]?.name ?? `#${e.species}`} <button class="link small" onClick={() => toggleHunt(e.species, npc.id, npcName)} aria-label={`Remove ${ds.species[e.species]?.name} from the hunt list`}>✕</button></>
          ))}
        </div>
      )}
      <div class="small muted" style={{ marginTop: '4px' }}>
        Reachable maps are a guess: maps seen on the game's Explore page, Tips you ticked, and {npcName}'s place on the Tips progress path. A Surf/rod tag means MeowRPGAdvisor doesn't know if you have it.
        Scored like Worth grinding, with average IVs (15), no EVs and the level-up moves it has by then.
      </div>
    </div>
  );
}

function HuntRow({ ds, p, npc, npcName }: { ds: Dataset; p: HuntPick; npc: Npc; npcName: string }) {
  const s = ds.species[p.mon.species];
  const evo = p.evolvedTo ? ds.species[p.evolvedTo] : undefined;
  const { map, enc, access, needs } = p.where;
  const ball = huntBall(ds, p, bag.value ? ownedItems.value : null);
  const on = onHuntList(p.mon.species, npc.id);
  const time = enc.day > 0 && enc.night <= 0 ? ' · day only' : enc.night > 0 && enc.day <= 0 ? ' · night only' : '';
  return (
    <div class="mon">
      <div class="av">{s?.name.slice(0, 2).toUpperCase()}</div>
      <span class="nm">{s?.name}{evo ? <span class="muted"> → {evo.name}</span> : null}<Types types={(evo ?? s)?.types ?? []} /></span>
      <span class="row">
        <span class={`score ${scoreClass(p.potential)}`} title={`Score vs ${npcName} at Lv ${p.targetLevel}`}>{p.potential}</span>
        <button class={`btn sm${on ? ' primary' : ''}`} aria-pressed={on} onClick={() => toggleHunt(p.mon.species, npc.id, npcName)}
          title={on ? 'On your hunt list: Explore marks it and a wild one shows CATCH. Tap to remove.' : 'Add to your hunt list'}>{on ? '✓ Hunt list' : 'Hunt list'}</button>
      </span>
      <div class="full small">
        <b>Where:</b> {map.name} · {METHOD_LABEL[enc.method] ?? enc.method} · {RARITY_LABEL[enc.rarity] ?? enc.rarity} · Lv {enc.levels[0]}–{enc.levels[1]} · {pct(enc.day)} / {pct(enc.night)}{time}
        {p.otherSpots > 0 ? <span class="muted"> · +{p.otherSpots} other spot{p.otherSpots > 1 ? 's' : ''}</span> : null}
        {needs && <> <span class="chip sm warn" title="MeowRPGAdvisor doesn't know if you have it (tick it in Tips)">needs {needs}?</span></>}
        {ACCESS_LABEL[access.access] && <> <span class={`chip sm${access.access === 'seen' || access.access === 'ticked' ? '' : ' warn'}`} title={access.requires.join(' · ') || undefined}>{ACCESS_LABEL[access.access]}</span></>}
      </div>
      {access.tip && (access.access === 'locked' || access.access === 'guess') && (
        <div class="full small muted">
          To unlock: {access.requires.join(', ') || access.tip.title}. <button class="link small" onClick={() => openTip(access.tip!.id)}>How →</button>
        </div>
      )}
      <div class="full small"><b>Why:</b> {p.why}</div>
      <div class="full small muted">
        <b>Grind:</b> Lv {p.catchLevel} → {p.targetLevel} (+{p.levelsNeeded}){evo ? ` · evolves into ${evo.name} by then (scored as ${evo.name})` : ''} · {p.ivs.text}
      </div>
      <div class="full">{p.moves.map((m) => <MoveChip ds={ds} id={m.moveId} />)}</div>
      <div class="full small muted">
        <b>Catch:</b> {p.difficulty} (catch rate {p.catchRate}){ball ? <> · best ball{bag.value ? ' in your bag' : ''}: <b>{ball.name}</b> {pct(ball.chance)} per throw at full HP{ball.count !== undefined ? ` (×${ball.count})` : ''}</> : ''}
      </div>
    </div>
  );
}
