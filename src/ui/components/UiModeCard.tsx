import { useEffect, useState } from 'preact/hooks';
import { isExtension } from '../store';
import { MODE_KEY, DEFAULT_MODE, normalizeMode, type UiMode } from '../../shared/uiMode';

/** Settings card: where the toolbar icon opens MeowRPGAdvisor. The background worker reacts to the stored value. */
export function UiModeCard() {
  const [mode, setMode] = useState<UiMode>(DEFAULT_MODE);
  useEffect(() => {
    if (isExtension) chrome.storage.local.get(MODE_KEY).then((r) => setMode(normalizeMode(r[MODE_KEY]))).catch(() => {});
  }, []);
  if (!isExtension) return null;
  function choose(m: UiMode) {
    setMode(m);
    chrome.storage.local.set({ [MODE_KEY]: m }).catch(() => {});
  }
  return (
    <div class="card">
      <h3>Where MeowRPGAdvisor opens</h3>
      <label style="display:block;margin:6px 0">
        <input type="radio" name="uimode" checked={mode === 'window'} onChange={() => choose('window')} /> Floating window (default){' '}
        <span class="muted">– a small window that stays put when you switch tabs. Chrome cannot keep it always on top, so the browser can cover it.</span>
      </label>
      <label style="display:block;margin:6px 0">
        <input type="radio" name="uimode" checked={mode === 'panel'} onChange={() => choose('panel')} /> Side panel on game tabs only{' '}
        <span class="muted">– a docked panel that is only available on pokemeowrpg.com tabs.</span>
      </label>
      <p class="muted">Close the current window or panel after switching, then click the toolbar icon again.</p>
    </div>
  );
}
