import type { ComponentType } from 'preact';
import { activeTab, dataset, type TabId } from './store';
import { NpcTab } from './tabs/NpcTab';
import { TeamTab } from './tabs/TeamTab';
import { BattleTab } from './tabs/BattleTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ExploreTab } from './tabs/ExploreTab';
import { TipsTab } from './tabs/TipsTab';

/** Tab registry: add a tab here to extend the panel. */
export interface TabDef {
  id: TabId;
  label: string;
  aria?: string;
  component: ComponentType;
}

export const TABS: TabDef[] = [
  { id: 'npc', label: 'NPC', component: NpcTab },
  { id: 'team', label: 'Team', component: TeamTab },
  { id: 'battle', label: 'Battle', component: BattleTab },
  { id: 'explore', label: 'Explore', component: ExploreTab },
  { id: 'tips', label: 'Tips', component: TipsTab },
  { id: 'settings', label: '⚙', aria: 'Settings', component: SettingsTab },
];

export function App() {
  const current = TABS.find((t) => t.id === activeTab.value) ?? TABS[0];
  const Body = current.component;
  const ds = dataset.value;
  return (
    <>
      <header class="head">
        <div class="brandrow">
          <span class="ball lg" aria-hidden="true" />
          <span class="brand">Meow<span>Helper</span></span>
          <span class="status" title={ds ? `Data: ${ds.version}` : 'No data yet'}>
            <i class={`dot${ds ? '' : ' off'}`} />
            {ds ? `${ds.npcs.length} NPCs` : 'No data yet'}
          </span>
        </div>
        <nav class="tabs" role="tablist">
          {TABS.map((t) => (
            <button class={`tab${t.id === current.id ? ' on' : ''}`} role="tab" aria-selected={t.id === current.id} aria-label={t.aria} onClick={() => (activeTab.value = t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main class="body">
        <Body />
      </main>
    </>
  );
}
