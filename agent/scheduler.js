/*
 * scheduler.js — fire the crawl on a daily cadence with jitter.
 *
 * `nextRunAt` is a PURE function (testable without Electron): given the current
 * time and the cadence, it returns the next wall-clock slot. The scheduler wraps
 * it with a setTimeout loop, an isRunning guard (never overlap a crawl), and a
 * manual runNow().
 */

/**
 * Next scheduled run strictly after `now`.
 * Slots are spread evenly across the day from `anchorHour` (e.g. runsPerDay=2,
 * anchorHour=9 -> 09:00 and 21:00 local).
 * @param {number|Date} now
 * @param {{runsPerDay?:number, anchorHour?:number}} opts
 * @returns {Date}
 */
function nextRunAt(now, opts = {}) {
  const runsPerDay = Math.max(1, opts.runsPerDay || 2);
  const anchorHour = opts.anchorHour == null ? 9 : opts.anchorHour;
  const t = typeof now === 'number' ? now : now.getTime();
  const intervalH = 24 / runsPerDay;

  const slots = [];
  for (let i = 0; i < runsPerDay; i++) slots.push((anchorHour + i * intervalH) % 24);

  const d = new Date(t);
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const h of slots) {
      const cand = new Date(
        d.getFullYear(), d.getMonth(), d.getDate() + dayOffset,
        Math.floor(h), Math.round((h % 1) * 60), 0, 0
      );
      if (cand.getTime() > t) return cand;
    }
  }
  // Defensive fallback (shouldn't be reached): one interval out.
  return new Date(t + intervalH * 3600 * 1000);
}

/**
 * Create a scheduler around a runJob() that resolves when a crawl+push is done.
 * @param {{runsPerDay?:number, anchorHour?:number, jitterMinutes?:number,
 *          runJob:()=>Promise<any>, log?:(m:string)=>void, randomFn?:()=>number}} cfg
 */
function createScheduler(cfg) {
  const { runJob } = cfg;
  const runsPerDay = cfg.runsPerDay || 2;
  const anchorHour = cfg.anchorHour == null ? 9 : cfg.anchorHour;
  const jitterMinutes = cfg.jitterMinutes || 0;
  const log = cfg.log || (() => {});
  const rand = cfg.randomFn || Math.random;

  let timer = null;
  let running = false;
  let lastResult = null;
  let nextRunTime = null;

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const next = nextRunAt(Date.now(), { runsPerDay, anchorHour });
    const jitterMs = (rand() * 2 - 1) * jitterMinutes * 60 * 1000;
    const delay = Math.max(60 * 1000, next.getTime() - Date.now() + jitterMs);
    nextRunTime = new Date(Date.now() + delay);
    log(`next run ~ ${nextRunTime.toISOString()} (in ${Math.round(delay / 60000)}m)`);
    timer = setTimeout(() => { tick().catch(() => {}); }, delay);
  }

  async function tick() {
    if (running) { log('scheduled tick skipped — a crawl is already running'); scheduleNext(); return; }
    await run();
    scheduleNext();
  }

  async function run() {
    running = true;
    try {
      lastResult = await runJob();
      return lastResult;
    } catch (e) {
      log('crawl job failed: ' + (e && e.message ? e.message : String(e)));
      throw e;
    } finally {
      running = false;
    }
  }

  return {
    start() { scheduleNext(); },
    stop() { if (timer) clearTimeout(timer); timer = null; },
    /** Manual trigger; ignored (returns last result) if a crawl is in flight. */
    async runNow() {
      if (running) { log('runNow ignored — a crawl is already running'); return lastResult; }
      return run();
    },
    isRunning() { return running; },
    get lastResult() { return lastResult; },
    get nextRunTime() { return nextRunTime; },
  };
}

module.exports = { nextRunAt, createScheduler };
