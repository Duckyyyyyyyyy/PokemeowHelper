import { activeTab, loading } from '../store';
import { Empty } from '../components/common';

export function NoData() {
  if (loading.value) return <Empty title="Opening MeowDex…" />;
  return (
    <Empty title="No NPC data yet">
      <p class="small">Log in to pokemeowrpg.com in Chrome, then sync the wiki data once.</p>
      <button class="btn primary" onClick={() => (activeTab.value = 'settings')}>Go to Sync</button>
    </Empty>
  );
}
