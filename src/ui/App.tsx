import type { ComponentType } from 'preact';
import { activeTab, dataset, type TabId } from './store';
import { BattleTab } from './tabs/BattleTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ExploreTab } from './tabs/ExploreTab';
import { TipsTab } from './tabs/TipsTab';
import { PrepTab } from './tabs/PrepTab';
import { TrainTab } from './tabs/TrainTab';
import { battle } from './battleStore';
import { wild } from './wildStore';
import { Icon } from './components/hud';

/** Tab registry: the five HUD tabs; Settings sits behind the gear. */
export interface TabDef {
  id: TabId;
  label: string;
  icon: string;
  component: ComponentType;
}

export const TABS: TabDef[] = [
  { id: 'battle', label: 'Battle', icon: 'battle', component: BattleTab },
  { id: 'wild', label: 'Wild', icon: 'wild', component: ExploreTab },
  { id: 'prep', label: 'Prep', icon: 'prep', component: PrepTab },
  { id: 'train', label: 'Train', icon: 'train', component: TrainTab },
  { id: 'guide', label: 'Guide', icon: 'guide', component: TipsTab },
];

export function App() {
  const id = activeTab.value;
  const Body = id === 'settings' ? SettingsTab : (TABS.find((t) => t.id === id) ?? TABS[2]).component;
  const ds = dataset.value;
  // Red dot: something live is going on in that tab.
  const live: Partial<Record<TabId, boolean>> = { battle: battle.value?.status === 'active', wild: !!wild.value };
  return (
    <>
      <header class="hud">
        <span class="logo" title={ds ? `MeowRPGAdvisor · data ${ds.version} · ${ds.npcs.length} NPCs` : 'MeowRPGAdvisor · no data yet'}>
          <span class="ball lg" aria-hidden="true" />
          <span class="name">MeowRPG<b>Advisor</b></span>
          <span class={`datadot${ds ? '' : ' off'}`} aria-hidden="true" />
        </span>
        <nav role="tablist" aria-label="MeowRPGAdvisor">
          {TABS.map((t) => (
            <button class={t.id === id ? 'on' : ''} role="tab" aria-selected={t.id === id} onClick={() => (activeTab.value = t.id)}>
              <Icon name={t.icon} size={17} />
              <span>{t.label}</span>
              {live[t.id] && <i class="live" aria-label="live" />}
            </button>
          ))}
        </nav>
        <button class={`gear${id === 'settings' ? ' on' : ''}`} aria-label="Settings" aria-pressed={id === 'settings'} onClick={() => (activeTab.value = 'settings')}>
          <Icon name="gear" size={19} />
        </button>
      </header>
      <main class="body">
        <Body />
      </main>
    </>
  );
}
