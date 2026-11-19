import type { Npc } from '../../shared/types';
import { facilityOf } from '../../engine/frontier';
import { TOWER_RULES_TEXT } from '../../engine/towerPlan';
import { levelMode, setLevelMode } from '../frontierPrefs';
import { Tip } from './common';

/** Level 50 / Open Level switch for Battle Frontier NPCs. */
export function LevelModeSeg({ level, estimated }: { level?: number; estimated?: boolean }) {
  const mode = levelMode.value;
  return (
    <>
      <div class="seg" role="tablist" aria-label="Frontier level category">
        <button class={mode === 'lv50' ? 'on' : ''} role="tab" aria-selected={mode === 'lv50'} onClick={() => setLevelMode('lv50')}>Level 50</button>
        <button class={mode === 'open' ? 'on' : ''} role="tab" aria-selected={mode === 'open'} onClick={() => setLevelMode('open')}>Open Level</button>
      </div>
      {level !== undefined && level > 0 && (
        <div class="small muted" style={{ padding: '0 4px' }}>
          {mode === 'lv50'
            ? 'Brain Pokémon are Lv 50; yours must be Lv 50 or below (not scaled down).'
            : `Brain Pokémon match your highest registered level, minimum 60: Lv ${level}${estimated ? ' (from your highest Pokémon that may enter – change it by what you register)' : ''}.`}
        </div>
      )}
    </>
  );
}

/** Rules card for Battle Frontier facilities and Battle Towers (NPC tab). */
export function FacilityRules({ npc }: { npc: Npc }) {
  if (npc.category === 'tower') {
    return (
      <Tip kind="info">
        <b>Battle Tower rules:</b> {TOWER_RULES_TEXT} The 20 sets below are fixed (not a random pool); switching changes the order you meet them, so the type cards cover all 20.
      </Tip>
    );
  }
  const f = facilityOf(npc);
  if (!f) return null;
  return (
    <div class="card">
      <p class="title">{f.name} rules <span class="r">Gen III</span></p>
      <div class="small">
        <div>Round: {f.round} · register {f.register}, battle with {f.battleWith} · {f.restored ? 'restored after each battle' : 'HP, status and PP carry over'}.</div>
        {f.rules.map((r) => <div>• {r}</div>)}
        <div>• Gen III rules: no Fairy type, a move's type decides physical/special (Ghost uses Attack, Dark uses Sp. Atk), Gen III power, stats and abilities; Steel resists Ghost and Dark.</div>
        <div>• Gen I–III Pokémon, moves and held items only; one of each species and each held item; no Mega/Z/Dynamax/Tera. Restricted legendaries are excluded (the wiki gives no list – MeowRPGAdvisor guesses Emerald's).</div>
        <div>• Symbols: {f.symbols}. BP: {f.bp}.</div>
        <div class="bad-t">• Hardcore runs: your own Pokémon that faint are lost for good{f.ownTeam ? '' : ' (rentals are exempt)'}.</div>
      </div>
      <div class="small muted" style={{ marginTop: '4px' }}>Other Frontier trainers use Pokémon Emerald's teams, which are not in the wiki data: only the Brain can be planned exactly. Source: wiki {f.source}.</div>
    </div>
  );
}
