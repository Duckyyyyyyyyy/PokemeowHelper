import { useMemo } from 'preact/hooks';
import type { BoxMon, Dataset, NpcTeamVariant } from '../../shared/types';
import type { BattleRules } from '../../engine/rules';
import {
  EV_BERRY, POWER_ITEM, STAT_NAME, VITAMIN, VITAMIN_EVS, evPlanFor, koCount, npcEvBattles, trainingAccounts, wildEvSpots, type StatKey,
} from '../../engine/evPlan';

const evText = (e: Record<StatKey, number>) => {
  const parts = (Object.keys(e) as StatKey[]).filter((k) => e[k]).map((k) => `${e[k]} ${STAT_NAME[k]}`);
  return parts.length ? parts.join(' / ') : 'none';
};

/** EV advice for one team member vs this NPC: best common spread, what to change, where to farm. */
export function EvPanel({ ds, mon, v, rules, tower }: { ds: Dataset; mon: BoxMon; v: NpcTeamVariant; rules?: BattleRules; tower?: boolean }) {
  const plan = useMemo(() => evPlanFor(ds, mon, v, { levelCap: v.levelCap, rules, tower }), [ds, mon, v]);
  const hasYields = useMemo(() => Object.values(ds.species).some((s) => s.evYield), [ds]);
  const n = v.team.length;
  const { raise, lower } = plan;
  const known = !!mon.evs && Object.keys(mon.evs).length > 0;
  const maxLevel = (mon.level ?? plan.level) + 10;
  return (
    <div class="small" style={{ marginTop: '4px' }}>
      <div>
        EVs now: <b>{evText(plan.now.evs)}</b>{!known && mon.source !== 'game' ? <span class="muted"> (not known for hand-typed Pokémon: Box Sync reads them)</span> : null} → wins {plan.now.wins}/{n}
        {plan.atFightLevel ? <span class="muted"> at Lv {plan.level}</span> : null}
      </div>
      {plan.changes.length ? (
        <>
          <div>
            Best vs this NPC: <b>{plan.best.label}</b> ({evText(plan.best.evs)}) → <b>wins {plan.best.wins}/{n}</b>
            {!plan.improves ? <span class="muted"> · no 1v1 result changes yet: a small edge; levels or moves matter more (see Grind levels)</span> : null}
          </div>
          {raise.length > 0 && <div>Raise: {raise.map((c) => `${STAT_NAME[c.stat]} +${c.to - c.from}`).join(', ')}</div>}
          {lower.length > 0 && (
            <div>Lower first to fit 510: {lower.map((c) => `${STAT_NAME[c.stat]} −${c.from - c.to} (${Math.ceil((c.from - c.to) / VITAMIN_EVS)} ${EV_BERRY[c.stat]})`).join(', ')}, or reset all with a Fresh-Start Mochi.</div>
          )}
        </>
      ) : (
        <div class="muted">Your EVs already match the best common spread here ({plan.best.label}).</div>
      )}
      <div class="muted">Others: {plan.ranked.slice(1, 4).map((r) => `${r.label} ${r.wins}/${n}`).join(' · ')}</div>
      {raise.map((c) => <FarmStat ds={ds} stat={c.stat} need={c.to - c.from} hasYields={hasYields} maxLevel={maxLevel} />)}
      {raise.length > 0 && <div class="muted">Tip: a teammate that holds an Exp. Share gets the same EVs while another Pokémon does the battling.</div>}
      <div class="muted" style={{ marginTop: '4px' }}>
        Scored at Lv {plan.level}{plan.atFightLevel ? " (this fight's level)" : ''}: 252 EVs add {Math.floor((63 * plan.level) / 100)} points to a stat there (63 at Lv 100). Max 252 per stat, 510 total.
        EVs come from wild and trainer/NPC battles; World Bosses, the Battle Frontier, live PvP and Quick catch give none.
      </div>
    </div>
  );
}

function FarmStat({ ds, stat, need, hasYields, maxLevel }: { ds: Dataset; stat: StatKey; need: number; hasYields: boolean; maxLevel: number }) {
  const wild = useMemo(() => wildEvSpots(ds, stat, 2), [ds, stat]);
  const npcs = useMemo(() => npcEvBattles(ds, stat, 2, maxLevel), [ds, stat, maxLevel]);
  const accounts = useMemo(() => trainingAccounts(ds, stat), [ds, stat]);
  const vit = Math.ceil(need / VITAMIN_EVS);
  return (
    <div style={{ marginTop: '4px' }}>
      <b>{STAT_NAME[stat]} +{need}</b>
      <div>· {vit} × {VITAMIN[stat]} (10 each) · hold a <b>{POWER_ITEM[stat]}</b> while farming: +8 per knockout</div>
      {!hasYields && <div class="muted">· Press Sync data once in Settings (⚙) to see which Pokémon and NPCs give {STAT_NAME[stat]} EVs.</div>}
      {accounts.map(({ account: a, amount }) => {
        const k = amount ? koCount(need, amount) : null;
        return (
          <div>
            · Training account <b>{a.account}</b> (Player Battles): {a.pokemon} Lv {a.levels[0]}{a.levels[1] !== a.levels[0] ? `–${a.levels[1]}` : ''}, weak to {a.weakTo.join(', ')}
            {k ? `: ${amount} ${STAT_NAME[stat]} per win → ${k.power} wins with ${POWER_ITEM[stat]}, ${k.plain} without` : ''}
            <span class="muted"> (shared by players, unverified; no EVs at the Lv 50/100 settings or on Hardcore)</span>
          </div>
        );
      })}
      {wild.map((s) => {
        const k = koCount(need, s.amount);
        return (
          <div>
            · Wild <b>{s.name}</b> ({s.amount} {STAT_NAME[stat]}{s.also.length ? `, ${s.also.join(', ')}` : ''}; {s.rarity.replace('-', ' ')}) in {s.maps.slice(0, 2).join(', ')}{s.maps.length > 2 ? '…' : ''}: {k.power} knockouts with {POWER_ITEM[stat]}, {k.plain} without
          </div>
        );
      })}
      {npcs.map((b) => {
        const perWin = b.amount;
        const withPower = b.amount + 8 * b.npc.variants[b.variant].team.length;
        return (
          <div>
            · <b>{b.npc.name}</b> {b.label} (top Lv {b.topLevel}): {perWin} {STAT_NAME[stat]} per win → {Math.ceil(need / perWin)} wins, {Math.ceil(need / withPower)} if the {POWER_ITEM[stat]} holder knocks out all {b.npc.variants[b.variant].team.length}
          </div>
        );
      })}
    </div>
  );
}
