/*
 * interference.js — a tiny shared event bus.
 *
 * Decouples the scraper from whoever reacts to "interference" (a human needs to
 * step in) and lifecycle events. M2 listener: main.js shows/focuses the scrape
 * window on 'challenge'. M3: a Telegram relay can subscribe to the SAME bus
 * (challenge/error/done) without the scraper knowing it exists.
 *
 * Events:
 *   'progress' (msg:string)         — human-readable crawl progress
 *   'challenge'()                   — a Cloudflare/Turnstile gate is on screen
 *   'pushed'  (stats:object)        — backend accepted an ingest
 *   'done'    ({received, stats?})  — a crawl+push cycle finished
 *   'error'   (err:Error)           — something failed
 */
const { EventEmitter } = require('events');

class InterferenceBus extends EventEmitter {}

// Single shared instance for the whole app.
module.exports = new InterferenceBus();
