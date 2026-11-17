import { render } from 'preact';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './theme.css';
import { App } from './App';
import { init } from './store';
import { applyTheme, savedTheme } from './tabs/SettingsTab';
import { initBoxSync, maybeAutoSyncBox } from './boxStore';

applyTheme(savedTheme());
render(<App />, document.getElementById('app')!);
Promise.all([init(), initBoxSync()]).then(maybeAutoSyncBox);
