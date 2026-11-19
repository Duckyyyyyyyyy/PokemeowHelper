import { dataset, goPrep, prepStep, selectedNpc, type PrepStep } from '../store';
import { NpcTab } from './NpcTab';
import { TeamTab } from './TeamTab';
import { NoData } from './shared';

const STEPS: [PrepStep, string][] = [['npc', 'Opponent'], ['team', 'Team'], ['hunt', 'Hunt & grind']];

/** Prep: one flow from picking the NPC to the team to bring, then what to catch and train. */
export function PrepTab() {
  if (!dataset.value) return <NoData />;
  const step = prepStep.value;
  const npc = selectedNpc.value;
  return (
    <>
      <nav class="stepper" aria-label="Prep steps">
        {STEPS.map(([id, label], i) => (
          <button class={step === id ? 'on' : ''} aria-current={step === id ? 'step' : undefined} onClick={() => goPrep(id)}
            title={id !== 'npc' && !npc ? 'Pick an NPC first' : undefined}>
            <i>{i + 1}</i>{label}
          </button>
        ))}
      </nav>
      {step === 'npc' ? <NpcTab /> : step === 'team' ? <TeamTab part="team" /> : <TeamTab part="hunt" />}
    </>
  );
}
