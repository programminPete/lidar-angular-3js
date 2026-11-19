#!/usr/bin/env node
/**
 * Records a real-time demo video of the platform screen in headless Chrome, driven over the DevTools protocol.
 * No dependencies: Node 22's built-in fetch and WebSocket talk to Chrome; ffmpeg assembles the frames.
 *
 * Usage (with `npm start` running on port 4200):
 *   node tools/record-demo.mjs
 *   node tools/record-demo.mjs --url http://localhost:4200 --out docs/demo.mp4 --no-cursor
 *
 * Options:
 *   --url URL       app address (default http://localhost:4200)
 *   --out FILE      MP4 path (default docs/demo.mp4)
 *   --method M      screencast | screenshots: how frames are captured (default screencast)
 *   --crf N         x264 quality, lower is better (default 22)
 *   --no-cursor     leave out the drawn mouse pointer
 *
 * Storyboard, in video seconds (recording starts 16 s before the shuttle docks, ~58 s after page load):
 *   0–1     default 3D framing, nothing moves
 *   1–13    a person handles the view: turns it, zooms toward the crowd, clicks someone, tilts it,
 *           clicks someone else, zooms back out and nudges it back to the whole-platform framing
 *   16      the shuttle docks and boarding starts; hold in 3D
 *   20.75   click "Plan"; hold while boarding continues
 *   29.5    click "3D"; a very slight drag, end at about 36 s
 *
 * A pointer drawn into the page (not part of the app) follows every dispatched mouse position,
 * because headless screencasts do not include the system cursor.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg';
const DEBUG_PORT = 9334;
const WIDTH = 1920;
const HEIGHT = 1080;
const OUTPUT_FPS = 30;
const MOVE_STEP_MS = 16;

/** Start recording when the countdown shows this many seconds to docking. */
const RECORD_SECONDS_BEFORE_DOCK = 16;
/** Video seconds of the later beats, kept from the approved cut. */
const PLAN_CLICK_AT = 20.75;
const THREE_D_CLICK_AT = 29.5;
const END_AT = 36.05;

const options = parseOptions(process.argv.slice(2));

const profileDir = mkdtempSync(join(tmpdir(), 'record-demo-profile-'));
const framesDir = mkdtempSync(join(tmpdir(), 'record-demo-frames-'));
const chrome = launchChrome(profileDir);

try {
  const page = await connectToPage();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `${options.url}/?view=3d` });
  await waitFor(page, `document.querySelector('ow-platform-3d canvas') !== null`, 20_000);
  await waitFor(page, `typeof ng !== 'undefined' && !!ng.getComponent(document.querySelector('ow-platform-3d'))?.stage`, 10_000);
  console.log(`WebGL renderer: ${await evaluate(page, webglRendererExpression())}`);

  const mouse = createMouse(page, { x: 1010, y: 700 });
  if (options.cursor) {
    await evaluate(page, injectCursorExpression(mouse.x, mouse.y));
  }
  await mouse.moveTo(mouse.x, mouse.y);
  await waitForCountdown(page, RECORD_SECONDS_BEFORE_DOCK);

  const recorder = await startRecording(page, options.method);
  const at = (seconds) => sleep(recorder.startedAt + seconds * 1000 - Date.now());
  const beats = {};
  const mark = (name) => {
    beats[name] = (Date.now() - recorder.startedAt) / 1000;
    console.log(`${beats[name].toFixed(2)} s  ${name}`);
  };

  // ---- Opening: a person handling the 3D view ----
  // Net drag displacement is tracked so the last nudge returns the camera to its default angle.
  const net = { x: 0, y: 0 };
  const dragBy = async (dx, dy, durationMs, shape) => {
    await mouse.drag(mouse.x + dx, mouse.y + dy, durationMs, shape);
    net.x += dx;
    net.y += dy;
  };

  await at(0.9);
  mark('drag 1: turn left');
  await dragBy(-52, 5, 1100, { bend: 0.12, wobble: 1.2 });

  await at(2.35);
  mark('travel to the crowd near the doors');
  await mouse.travel(760, 430, 450, 0.1);
  await sleep(120);
  mark('wheel zoom in');
  await wheelBursts(page, mouse, [[-120, 8], [-110, 7], [-70, 5]]);
  mark('zoom in done');

  await at(4.15);
  const first = await pickPerson(page, { x: 680, y: 520 });
  await mouse.clickPerson(first, 620);
  mark(`clicked person 1 (${first.id})`);
  await expectSelected(page, first.id);

  await at(6.2);
  mark('drag 2: turn right with some tilt');
  await mouse.travel(mouse.x + 110, mouse.y + 80, 320, -0.15);
  await sleep(100);
  await dragBy(72, -24, 1300, { bend: -0.15, wobble: 1.5, hesitateAt: 0.42, hesitateMs: 200 });
  mark('drag 2 done');

  await at(8.4);
  const second = await pickPerson(page, { x: 1000, y: 520 }, [first.id]);
  await mouse.clickPerson(second, 560);
  mark(`clicked person 2 (${second.id})`);
  await expectSelected(page, second.id);

  await at(10.1);
  mark('wheel zoom out');
  await wheelBursts(page, mouse, [[160, 9], [140, 8]]);
  mark('zoom out done');

  await at(11.15);
  mark('corrective drag');
  await mouse.travel(mouse.x - 50, mouse.y + 40, 260, 0.1);
  await sleep(80);
  await dragBy(-net.x, -net.y, 800, { bend: 0.1, wobble: 0.8 });
  mark('corrective drag done');
  await sleep(500);
  await mouse.travel(mouse.x + 150, mouse.y + 130, 700, -0.1);

  await waitFor(page, `document.querySelector('ow-next-shuttle')?.textContent.includes('doors open')`, 30_000, 50);
  mark('docked, doors open');

  // ---- Later beats, at the same video times as before ----
  await at(PLAN_CLICK_AT - 0.85);
  await mouse.clickElement(toggleButtonExpression('Plan'), 650, recorder.startedAt + PLAN_CLICK_AT * 1000 - 85);
  mark('clicked Plan');

  await at(THREE_D_CLICK_AT - 0.75);
  await mouse.clickElement(toggleButtonExpression('3D'), 550, recorder.startedAt + THREE_D_CLICK_AT * 1000 - 85);
  mark('clicked 3D');

  await at(30.1);
  await mouse.travel(1000, 640, 800, 0.12);
  await at(31.0);
  await mouse.drag(mouse.x + 22, mouse.y, 4000, { bend: 0.05, wobble: 0.6, easing: easeInOut });
  await at(END_AT);
  mark('end');

  const frames = await recorder.stop();
  await page.send('Browser.close').catch(() => {});
  page.close();

  reportFrameRate(frames, beats);
  encode(frames, options);
} finally {
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  await exited;
  await sleep(500);
  for (const dir of [profileDir, framesDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`Could not remove ${dir}`);
    }
  }
}

// ---- Steps ----------------------------------------------------------------------------------

function parseOptions(args) {
  const parsed = { url: 'http://localhost:4200', out: 'docs/demo.mp4', method: 'screencast', crf: '22', cursor: true };
  for (let index = 0; index < args.length; index++) {
    const name = args[index].replace(/^--/, '');
    if (name === 'no-cursor') {
      parsed.cursor = false;
      continue;
    }
    parsed[name] = args[++index];
  }
  return parsed;
}

function launchChrome(userDataDir) {
  return spawn(
    CHROME,
    [
      '--headless=new',
      '--use-angle=metal',
      '--enable-gpu',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Keep timers and rAF at full rate even though no window is focused.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

/**
 * The one mouse: remembers where it is so every move starts from the last dispatched position.
 * Paths are slightly curved (`bend` is the sideways bulge as a share of the distance) with a small wobble.
 */
function createMouse(page, start) {
  const mouse = {
    x: start.x,
    y: start.y,

    async moveTo(x, y, buttons = 0) {
      mouse.x = x;
      mouse.y = y;
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: buttons ? 'left' : 'none', buttons });
    },

    /** Moves without a button held: eased in and out, slightly curved. */
    async travel(x, y, durationMs, bend = 0.08) {
      const path = curvedPath({ x: mouse.x, y: mouse.y }, { x, y }, bend, 0.6);
      for await (const elapsed of timeSteps(durationMs)) {
        const point = path(easeInOutCubic(elapsed));
        await mouse.moveTo(point.x, point.y);
      }
    },

    /**
     * A left-drag with a hand's speed profile: quick start, slow settle, optional hesitation.
     * OrbitControls damping carries the motion on after the release.
     */
    async drag(x, y, durationMs, { bend = 0.1, wobble = 1, hesitateAt = null, hesitateMs = 0, easing = easeOutHand } = {}) {
      const path = curvedPath({ x: mouse.x, y: mouse.y }, { x, y }, bend, wobble);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 });
      for await (const elapsed of timeSteps(durationMs + hesitateMs)) {
        const ms = elapsed * (durationMs + hesitateMs);
        let share = ms / durationMs;
        if (hesitateAt !== null) {
          const pauseStart = hesitateAt * durationMs;
          share = ms < pauseStart ? ms / durationMs : ms < pauseStart + hesitateMs ? hesitateAt : (ms - hesitateMs) / durationMs;
        }
        const point = path(easing(Math.min(1, share)));
        await mouse.moveTo(point.x, point.y, 1);
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 });
    },

    /** A press and release with no movement in between. */
    async click(pressAtMs = null) {
      if (pressAtMs !== null) {
        await sleep(pressAtMs - Date.now());
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(85);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 });
    },

    /** Travels to a person, follows them for the last few pixels, then clicks. */
    async clickPerson(person, durationMs) {
      await mouse.travel(person.x, person.y, durationMs, 0.1);
      const now = await personOnScreen(page, person.id);
      if (now === null) {
        throw new Error(`Person ${person.id} left before the click`);
      }
      if (Math.hypot(now.x - mouse.x, now.y - mouse.y) > 0.5) {
        await mouse.travel(now.x, now.y, 110, 0);
      }
      await sleep(130);
      await mouse.click();
    },

    /** Travels to an element's centre and clicks it, pressing at `pressAtMs` (epoch ms) when given; the click lands on release. */
    async clickElement(boxExpression, durationMs, pressAtMs = null) {
      const box = await evaluate(page, boxExpression);
      await mouse.travel(box.x, box.y, durationMs, 0.12);
      await mouse.click(pressAtMs);
    },
  };
  return mouse;
}

/** Uneven bursts of small wheel ticks, like a trackpad flick: each burst starts strong and tails off. */
async function wheelBursts(page, mouse, bursts) {
  for (const [total, ticks] of bursts) {
    const weights = Array.from({ length: ticks }, (_, i) => (ticks - i) * (0.85 + 0.3 * pseudoRandom(i + ticks)));
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    for (const weight of weights) {
      // Not awaited: Chrome answers a wheel event only after handling it, which would stretch each burst.
      page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mouse.x, y: mouse.y, deltaX: 0, deltaY: (total * weight) / weightSum });
      await sleep(16 + Math.round(10 * pseudoRandom(weight)));
    }
    await sleep(160 + Math.round(90 * pseudoRandom(total)));
  }
}

/**
 * Chooses a person to click: standing still or slow, not keep-clear (already orange), clear of
 * neighbours on screen so nobody hides them, away from the door labels and the view's edges,
 * and nearest to `near` (viewport pixels). Positions come from the 3D component itself.
 */
async function pickPerson(page, near, excludeIds = []) {
  const person = await evaluate(
    page,
    `(async () => {
      const component = ng.getComponent(document.querySelector('ow-platform-3d'));
      const stage = component.stage;
      const people = stage.people;
      const sample = () => {
        const rect = stage.canvas.getBoundingClientRect();
        const byId = new Map();
        for (let i = 0; i < people.count; i++) {
          const p = stage.project(people.xAt(i), people.yAt(i), 1, component.projected);
          byId.set(people.idAt(i), { id: people.idAt(i), mx: people.xAt(i), my: people.yAt(i), x: rect.left + p.x, y: rect.top + p.y, rect });
        }
        return byId;
      };
      const before = sample();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = sample();
      const keepClear = component.store.metrics().keepClearTrackIds;
      const exclude = new Set(${JSON.stringify(excludeIds)});
      const labels = [...document.querySelectorAll('ow-platform-3d .door-label')].map((label) => label.getBoundingClientRect());
      const everyone = [...after.values()];
      const candidates = everyone.filter((person) => {
        const earlier = before.get(person.id);
        if (!earlier || keepClear.has(person.id) || exclude.has(person.id)) return false;
        const speed = Math.hypot(person.mx - earlier.mx, person.my - earlier.my) / 0.3;
        if (speed > 0.2) return false;
        const r = person.rect;
        if (person.x < r.left + 160 || person.x > r.right - 160 || person.y < r.top + 140 || person.y > r.bottom - 140) return false;
        if (everyone.some((other) => keepClear.has(other.id) && Math.hypot(other.x - person.x, other.y - person.y) < 110)) return false;
        if (everyone.some((other) => other !== person && Math.abs(other.x - person.x) < 28 && Math.abs(other.y - person.y) < 75)) return false;
        return !labels.some((l) => person.x > l.left - 45 && person.x < l.right + 45 && person.y > l.top - 50 && person.y < l.bottom + 60);
      });
      candidates.sort((a, b) => Math.hypot(a.x - ${near.x}, a.y - ${near.y}) - Math.hypot(b.x - ${near.x}, b.y - ${near.y}));
      const best = candidates[0];
      return best ? { id: best.id, x: best.x, y: best.y, candidates: candidates.length } : null;
    })()`,
    true,
  );
  if (person === null) {
    throw new Error('No clearly visible, still person to click');
  }
  console.log(`  picked ${person.id} at ${Math.round(person.x)}, ${Math.round(person.y)} (of ${person.candidates} candidates)`);
  return person;
}

/** A person's current waist position in viewport pixels, or null if they are gone. */
async function personOnScreen(page, id) {
  return evaluate(
    page,
    `(() => {
      const component = ng.getComponent(document.querySelector('ow-platform-3d'));
      const stage = component.stage;
      const people = stage.people;
      const rect = stage.canvas.getBoundingClientRect();
      for (let i = 0; i < people.count; i++) {
        if (people.idAt(i) === ${JSON.stringify(id)}) {
          const p = stage.project(people.xAt(i), people.yAt(i), 1, component.projected);
          return { x: rect.left + p.x, y: rect.top + p.y };
        }
      }
      return null;
    })()`,
  );
}

/** Fails the run unless the click selected this person and their tag is showing. */
async function expectSelected(page, id) {
  await sleep(250);
  const state = await evaluate(
    page,
    `(() => {
      const component = ng.getComponent(document.querySelector('ow-platform-3d'));
      const tag = document.querySelector('ow-platform-3d .selected-tag');
      return { selected: component.store.selectedTrackId(), tagShown: !!tag && !tag.hidden, tagText: tag?.textContent.replace(/\\s+/g, ' ').trim() };
    })()`,
  );
  if (state.selected !== id || !state.tagShown) {
    throw new Error(`Click did not select ${id}: selected ${state.selected}, tag shown ${state.tagShown}`);
  }
  console.log(`  selected, tag reads "${state.tagText}"`);
}

function toggleButtonExpression(label) {
  return `(() => {
    const button = [...document.querySelectorAll('ow-view-toggle button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    const r = button.getBoundingClientRect();
    return { x: r.left + r.width / 2 + 3, y: r.top + r.height / 2 + 2 };
  })()`;
}

/** A macOS-sized arrow pointer that follows dispatched mouse positions; never takes events. */
function injectCursorExpression(x, y) {
  return `(() => {
    const cursor = document.createElement('div');
    cursor.id = 'record-demo-cursor';
    cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg"><path d="M2 2 L2 23.5 L7.2 18.6 L10.6 26.6 L14.2 25.1 L10.9 17.2 L17.8 17.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: 'fixed', left: '0', top: '0', width: '22px', height: '30px', pointerEvents: 'none',
      zIndex: '2147483647', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))', willChange: 'transform',
    });
    const place = (px, py) => { cursor.style.transform = 'translate(' + (px - 2) + 'px, ' + (py - 2) + 'px)'; };
    place(${x}, ${y});
    document.body.appendChild(cursor);
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'mousemove']) {
      window.addEventListener(type, (event) => place(event.clientX, event.clientY), { capture: true, passive: true });
    }
    return true;
  })()`;
}

async function waitForCountdown(page, seconds) {
  const text = `0:${String(seconds).padStart(2, '0')}`;
  console.log(`Waiting for the countdown to reach ${text}…`);
  await waitFor(page, `document.querySelector('ow-next-shuttle .countdown')?.textContent.trim() === '${text}'`, 120_000, 50);
}

/** Captures frames with their real timestamps, via the screencast or a tight screenshot loop. */
async function startRecording(page, method) {
  const frames = [];
  let frameNumber = 0;
  const save = (data, timestamp) => {
    const file = join(framesDir, `frame-${String(frameNumber++).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, timestamp });
  };

  if (method === 'screenshots') {
    let running = true;
    const loop = (async () => {
      while (running) {
        const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
        save(data, Date.now() / 1000);
      }
    })();
    return {
      startedAt: Date.now(),
      async stop() {
        running = false;
        await loop;
        return frames;
      },
    };
  }

  page.onEvent('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    save(data, metadata.timestamp);
    page.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  const startedAt = Date.now();
  return {
    startedAt,
    async stop() {
      await page.send('Page.stopScreencast');
      await sleep(200);
      return frames.sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}

function reportFrameRate(frames, beats) {
  const first = frames[0].timestamp;
  const span = frames.at(-1).timestamp - first;
  console.log(`Captured ${frames.length} frames over ${span.toFixed(2)} s: average ${(frames.length / span).toFixed(1)} fps`);
  const inWindow = (from, to) => frames.filter((f) => f.timestamp - first >= from && f.timestamp - first < to).length / (to - from);
  console.log(`  3D opening (handling + dock hold): ${inWindow(0, beats['clicked Plan']).toFixed(1)} fps`);
  console.log(`  Plan hold: ${inWindow(beats['clicked Plan'], beats['clicked 3D']).toFixed(1)} fps`);
  console.log(`  Final 3D hold: ${inWindow(beats['clicked 3D'], span).toFixed(1)} fps`);
  let longest = 0;
  for (let i = 1; i < frames.length; i++) {
    longest = Math.max(longest, frames[i].timestamp - frames[i - 1].timestamp);
  }
  console.log(`  Longest gap between frames: ${(longest * 1000).toFixed(0)} ms`);
}

/** Holds each frame for its real duration, then resamples to a constant frame rate. */
function encode(capturedFrames, { out, crf }) {
  // Screencast frames can arrive slightly out of order; keep one frame per timestamp, in order.
  const frames = [...capturedFrames]
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((frame, index, all) => index === 0 || frame.timestamp > all[index - 1].timestamp);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, index) => {
    const next = frames[index + 1];
    lines.push(`file '${frame.file}'`);
    lines.push(`duration ${next ? (next.timestamp - frame.timestamp).toFixed(6) : (1 / OUTPUT_FPS).toFixed(6)}`);
  });
  // The concat demuxer needs the last file repeated for its duration to count.
  lines.push(`file '${frames.at(-1).file}'`);
  const listFile = join(framesDir, 'frames.ffconcat');
  writeFileSync(listFile, lines.join('\n') + '\n');

  mkdirSync(dirname(out), { recursive: true });
  const result = spawnSync(
    FFMPEG,
    [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `fps=${OUTPUT_FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos:in_range=full:out_range=tv,format=yuv420p`,
      '-fps_mode', 'cfr', '-r', String(OUTPUT_FPS),
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-tune', 'animation',
      '-an', '-movflags', '+faststart',
      out,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('ffmpeg failed');
  }
  console.log(`Saved ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

// ---- DevTools protocol plumbing (same approach as capture-3d.mjs) ---------------------------

async function connectToPage() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const pageTarget = targets.find((target) => target.type === 'page');
      if (pageTarget) {
        return openSession(pageTarget.webSocketDebuggerUrl);
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error('Chrome did not open a debuggable page');
}

function openSession(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      listeners.get(message.method)?.(message.params);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      waiting.reject(new Error(message.error.message));
    } else {
      waiting.resolve(message.result);
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });

  return opened.then(() => ({
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    onEvent(method, listener) {
      listeners.set(method, listener);
    },
    close() {
      socket.close();
    },
  }));
}

async function evaluate(page, expression, awaitPromise = false) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

async function waitFor(page, expression, timeoutMs, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(page, expression).catch(() => false)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function canvasCentre(page) {
  return evaluate(page, `(() => { const r = document.querySelector('ow-platform-3d canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}

function webglRendererExpression() {
  return `(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  })()`;
}

/**
 * Yields progress from 0 to 1 (ending exactly on 1) about every MOVE_STEP_MS of wall-clock time,
 * so a move lasts its real duration however long each protocol call takes.
 */
async function* timeSteps(durationMs) {
  const start = Date.now();
  while (true) {
    const tickStart = Date.now();
    const progress = Math.min(1, (tickStart - start) / durationMs);
    yield progress;
    if (progress >= 1) {
      return;
    }
    await sleep(Math.max(0, MOVE_STEP_MS - (Date.now() - tickStart)));
  }
}

/** Quick start, long slow settle: how a hand drags. */
function easeOutHand(t) {
  return 1 - Math.pow(1 - t, 2.6);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A path from a to b that bulges sideways by `bend` × distance and wobbles by about `wobble` px. */
function curvedPath(a, b, bend, wobble) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const phase = (a.x * 0.37 + a.y * 0.11) % (2 * Math.PI);
  return (t) => {
    const side = bend * length * Math.sin(Math.PI * t) + wobble * Math.sin(phase + t * 17) * Math.sin(Math.PI * t);
    return { x: a.x + dx * t + normal.x * side, y: a.y + dy * t + normal.y * side };
  };
}

/** Repeatable 0–1 noise, so every take moves the same way. */
function pseudoRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
