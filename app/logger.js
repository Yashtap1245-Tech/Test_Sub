// logger.js — Structured Logging Module for PolicyLens

const SESSION_ID = 'sess_' + Math.random().toString(36).substring(2, 15);
let currentMode = 'manual'; // Default mode, can be 'ai' or 'manual'
let logCallback = null;

export const logger = {
  setMode(mode) {
    currentMode = mode;
    this.event('session_mode_changed', { mode });
  },

  setLogCallback(callback) {
    logCallback = callback;
  },

  event(name, payload = {}) {
    const entry = {
      event: name,
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      mode: currentMode,
      ...payload
    };

    // 1. Output to browser console
    console.log(`[PolicyLens Log]`, entry);

    // 2. Output to UI log viewer if subscribed
    if (logCallback) {
      logCallback(entry);
    }

    // 3. Production hooks go here (e.g. sending to Supabase, PostHog, or custom REST endpoint)
    this._sendToProduction(entry);
  },

  _sendToProduction(entry) {
    // Under production circumstances, this is where you would make an asynchronous API call:
    /*
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(err => console.error('Failed to send log to persistent store:', err));
    */
  }
};
