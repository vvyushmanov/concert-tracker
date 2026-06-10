/*
 * pause.js — renderer for the floating "Crawl paused" prompt (pause.html).
 *
 * A tiny always-on-top window main.js opens on every pause and CLOSES
 * programmatically the moment the pause resolves (Continue / Stop / auto-resume
 * on sign-in / timeout) — which a native dialog.showMessageBox could not do.
 *
 * Buttons reuse the same bridge the dashboard does (window.agent from preload):
 * Continue → agent:continue, Stop → agent:stop. Both run resolveContinue() in
 * main, which then destroys this window — so we just lock the buttons on click.
 */
const reason = new URLSearchParams(location.search).get('reason') || '';
document.getElementById('reason').textContent = reason;

const cont = document.getElementById('continue');
const stop = document.getElementById('stop');

function lock() { cont.disabled = true; stop.disabled = true; }

cont.addEventListener('click', async () => {
  lock();
  try { await window.agent.continue(); } catch { /* window is being torn down */ }
});
stop.addEventListener('click', async () => {
  lock();
  try { await window.agent.stop(); } catch { /* window is being torn down */ }
});
