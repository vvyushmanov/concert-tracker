/*
 * preload.js — the ONLY bridge between the (sandboxed, nodeIntegration-off)
 * dashboard renderer and the main process. Exposes a narrow, explicit API on
 * window.agent via contextBridge; never leaks raw ipcRenderer or Node.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Whitelisted one-way event channels the main process pushes to the dashboard.
const EVENT_CHANNELS = {
  log: 'agent:log',
  status: 'agent:status-update',
  challenge: 'agent:challenge',
  awaiting: 'agent:awaiting',
};

function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('agent', {
  // request/response
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (partial) => ipcRenderer.invoke('config:save', partial),
  getStatus: () => ipcRenderer.invoke('agent:status'),
  runNow: () => ipcRenderer.invoke('agent:runNow'),
  showScraper: () => ipcRenderer.invoke('agent:showScraper'),
  continue: () => ipcRenderer.invoke('agent:continue'),
  // subscriptions (return an unsubscribe fn)
  onLog: (cb) => subscribe(EVENT_CHANNELS.log, cb),
  onStatus: (cb) => subscribe(EVENT_CHANNELS.status, cb),
  onChallenge: (cb) => subscribe(EVENT_CHANNELS.challenge, cb),
  onAwaiting: (cb) => subscribe(EVENT_CHANNELS.awaiting, cb),
});
