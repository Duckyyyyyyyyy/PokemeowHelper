import { useMemo, useState } from 'preact/hooks';
import type { Dataset, NpcTeamVariant } from '../../shared/types';
import type { BattleRules } from '../../engine/rules';
import type { Candidate } from '../../engine/teamSuggest';
import { npcToCalc } from '../../engine/damage';
import { grindLadder, teamGrindPlan, type GrindLadder } from '../../engine/grindPlan';
import { ownedTms } from '../bagStore';

interface Common {
  ds: Dataset;
  v: NpcTeamVariant;
  rules?: BattleRules;
  tower?: boolean;
}

const ladderOf = ({ ds, v, rules, tower }: Common, c: Candidate, tms: ReadonlySet<string> | null, npcCalc = v.team.map((n) => npcToCalc(ds, n))) =>
  grindLadder(ds, c.mon, v, { levelCap: v.levelCap, rules, ownedTms: tms, tower }, npcCalc);

/** One team member's grind ladder: the levels where it starts beating each NPC Pokémon (computed on open). */
export function LadderPanel(props: Common & { c: Candidate; wins: number }) {
  const { ds, v, c, wins } = props;
  const tms = ownedTms.value;
  const lad = useMemo(() => ladderOf(props, c, tms), [ds, v, c.mon, tms]);
  if (!lad) return <div class="small muted">Already at this fight's level ({v.levelCap ? `cap ${v.levelCap}` : 'its top level'}): better moves, EVs or a held item are what's left.</div>;
  const n = v.team.length;
  const name = (id?: number) => (id !== undefined ? ds.species[id]?.name : undefined);
  return (
    <div class="small" style={{ marginTop: '4px' }}>
      <div>
        <b>Lv {lad.from}</b> now: wins {wins}/{n}
        {lad.start.won.length > wins ? <span class="muted"> · {lad.start.won.length}/{n} with its best moves by now</span> : null}
      </div>
      {lad.steps.map((r) => (
        <div>
          <b>Lv {r.level}</b> → {r.won.length}/{n}
          {r.gained.length ? <span class="ok-t"> + {r.gained.join(', ')}</span> : null}
          {r.lost.length ? <span class="bad-t"> − {r.lost.join(', ')}</span> : null}
          {r.evolvedTo !== undefined ? <span> · evolves into {name(r.evolvedTo)}</span> : null}
          {r.learns.length ? <span class="muted"> · learns {r.learns.join(', ')}</span> : null}
        </div>
      ))}
      {!lad.steps.some((r) => r.gained.length) && <div class="muted">No new wins up to Lv {lad.target}: try Hunt & grind for a better answer.</div>}
      <div class="muted">With the best moves it can have by each level{tms ? ' (TMs from your bag)' : ''}. Checked every 5 levels and at each evolution.</div>
    </div>
  );
}

/** Who to train next and how far, for the whole team (computed on a button press). */
export function GrindPlanCard(props: Common & { team: readonly Candidate[] }) {
  const { ds, v, team, tower } = props;
  const tms = ownedTms.value;
  const key = `${team.map((c) => `${c.mon.uid}@${c.mon.level}`).join(',')}|${tms ? tms.size : '-'}`;
  const [want, setWant] = useState<string | null>(null);
  const plan = useMemo(() => {
    if (want !== key) return null;
    const npcCalc = v.team.map((n) => npcToCalc(ds, n));
    const ladders = new Map<string, GrindLadder>();
    for (const c of team) {
      const l = ladderOf(props, c, tms, npcCalc);
      if (l) ladders.set(c.mon.uid, l);
    }
    return teamGrindPlan(team, ladders, v, ds, tower);
  }, [want, key, ds, v]);
  const n = v.team.length;
  return (
    <div class="card">
      <p class="title">Grind plan<span class="r">who to train, to what level</span></p>
      {!plan ? (
        <>
          <div class="small muted">Scores each team member at higher levels and finds the fewest levels that make the team beat what it can't yet.</div>
          <div class="btns" style={{ marginTop: '6px' }}>
            <button class="btn" onClick={() => setWant(key)}>Make a grind plan</button>
          </div>
        </>
      ) : (
        <div class="small">
          <div>Ready now: answers <b>{plan.now}/{n}</b></div>
          {plan.steps.map((s, i) => (
            <div>
              {i + 1}. <b>{s.name}</b> Lv {s.from} → <b>Lv {s.toLevel}</b>: beats {s.beats.join(', ')} <span class="muted">({s.answers}/{n})</span>
            </div>
          ))}
          {!plan.steps.length && plan.now < n && <div class="muted">Levels alone don't help this team.</div>}
          {plan.unreachable.length > 0 && <div class="muted">Nobody on this team beats {plan.unreachable.join(', ')} even at Lv {v.levelCap ?? 'max'}: see Hunt & grind.</div>}
          {plan.now >= n && <div class="muted">The team already answers every NPC Pokémon.</div>}
          <div class="muted">Best moves by each level; checked every 5 levels and at evolutions. 1v1 wins, as in the Matchups card.</div>
        </div>
      )}
    </div>
  );
}
