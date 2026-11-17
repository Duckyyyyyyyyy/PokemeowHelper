import { Empty, Tip } from '../components/common';

export function BattleTab() {
  return (
    <>
      <Empty title="In-battle tips – coming soon">
        <p class="small">Phase 3 will read the battle screen (read-only) and suggest the best move each turn.</p>
      </Empty>
      <Tip kind="info">MeowDex only gives advice. You always pick your moves – it never clicks for you.</Tip>
    </>
  );
}
