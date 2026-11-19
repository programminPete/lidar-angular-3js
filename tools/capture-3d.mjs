#!/usr/bin/env node
/**
 * Screenshots the 3D view (or the plan, with --view plan) in headless Chrome, driven over the DevTools protocol.
 * No dependencies: Node 22's built-in fetch and WebSocket talk to Chrome directly.
 *
 * Usage (with `npm start -- --port 4202` running):
 *   node tools/capture-3d.mjs --out shots/3d-normal-1920.png
 *   node tools/capture-3d.mjs --width 1280 --height 720 --state breach --select --out shots/3d-breach-1280.png
 *
 * Options:
 *   --url URL           app address (default http://localhost:4202)
 *   --view VIEW         3d | plan (default 3d)
 *   --width / --height  viewport in CSS pixels (default 1920 × 1080)
 *   --state STATE       normal | breach | docked: waits until the app shows that state (default normal)
 *   --select            clicks near the centre of the view until a person is selected
 *   --select-at FX,FY   same, starting from a point given as fractions of the view (e.g. 0.42,0.38)
 *   --angle swiftshader use software WebGL instead of the GPU
 *   --out FILE          PNG path (default shots/3d.png)
 *
 * Prints the WebGL renderer in use and the average frame time over three seconds.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;
const STATE_TIMEOUT_MS = 120_000;

const options = parseOptions(process.argv.slice(2));

const profileDir = mkdtempSync(join(tmpdir(), 'capture-3d-'));
const chrome = launchChrome(options, profileDir);

try {
  const page = await connectToPage();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: options.width,
    height: options.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const isPlan = options.view === 'plan';
  await page.send('Page.navigate', { url: `${options.url}/?view=${options.view}` });
  await waitFor(page, `document.querySelector('${isPlan ? 'ow-platform-plan svg' : 'ow-platform-3d canvas'}') !== null`, 20_000);
  const errors = [];
  page.onEvent('Runtime.exceptionThrown', (params) => errors.push(params.exceptionDetails.text));

  if (!isPlan) {
    console.log(`WebGL renderer: ${await evaluate(page, webglRendererExpression())}`);
  }
  await waitForState(page, options.state);
  if (options.select || options['select-at']) {
    const [startX, startY] = (options['select-at'] ?? '0.42,0.5').split(',').map(Number);
    await selectSomeone(page, startX, startY);
  }
  await sleep(1500);

  const frameTimes = await evaluate(page, frameTimeExpression(3000), true);
  console.log(`Frame time over 3 s: average ${frameTimes.average.toFixed(2)} ms, slowest ${frameTimes.slowest.toFixed(1)} ms (${frameTimes.frames} frames)`);

  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, Buffer.from(data, 'base64'));
  console.log(`Saved ${options.out}`);
  if (errors.length > 0) {
    console.log(`Page errors: ${errors.join('; ')}`);
  }

  await page.send('Browser.close').catch(() => {});
  page.close();
} finally {
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  chrome.kill();
  await exited;
  // Chrome's helper processes can still be writing to the profile for a moment after it exits.
  await sleep(500);
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`Could not remove the temporary profile at ${profileDir}`);
  }
}

// ---- Steps ----------------------------------------------------------------------------------

function parseOptions(args) {
  const parsed = { url: 'http://localhost:4202', view: '3d', width: 1920, height: 1080, state: 'normal', select: false, angle: 'metal', out: 'shots/3d.png' };
  for (let index = 0; index < args.length; index++) {
    const name = args[index].replace(/^--/, '');
    if (name === 'select') {
      parsed.select = true;
      continue;
    }
    const value = args[++index];
    parsed[name] = name === 'width' || name === 'height' ? Number(value) : value;
  }
  return parsed;
}

function launchChrome({ width, height, angle }, userDataDir) {
  const angleFlags = angle === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu'];
  return spawn(
    CHROME,
    [
      '--headless=new',
      ...angleFlags,
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

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

/** A minimal DevTools protocol client: `send` resolves with the command's result. */
function openSession(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  const listeners = new Map();

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

async function waitFor(page, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(page, expression).catch(() => false)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function waitForState(page, state) {
  if (state === 'breach') {
    console.log('Waiting for a capacity breach…');
    await waitFor(page, `document.querySelector('ow-breach-alert') !== null`, STATE_TIMEOUT_MS);
  } else if (state === 'docked') {
    console.log('Waiting for the shuttle to dock…');
    await waitFor(page, `document.querySelector('ow-next-shuttle')?.textContent.includes('doors open')`, STATE_TIMEOUT_MS);
    // Let the cars finish easing into the berth.
    await sleep(2000);
  } else {
    await sleep(3000);
  }
}

/** Clicks points spiralling out from a start point (fractions of the view) until the selected tag appears. */
async function selectSomeone(page, startX, startY) {
  const box = await evaluate(page, `(() => { const r = document.querySelector('ow-platform-3d canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
  for (let step = 0; step < 60; step++) {
    const angle = step * 2.4;
    const radius = 20 + step * 6;
    const x = box.x + box.width * startX + Math.cos(angle) * radius;
    const y = box.y + box.height * startY + Math.sin(angle) * radius * 0.6;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await sleep(120);
    if (await evaluate(page, `document.querySelector('.selected-tag') !== null`)) {
      console.log(`Selected a person at ${Math.round(x)}, ${Math.round(y)}`);
      return;
    }
  }
  console.log('Could not select anyone');
}

function webglRendererExpression() {
  return `(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  })()`;
}

/** Average and slowest requestAnimationFrame interval over a time window. */
function frameTimeExpression(windowMs) {
  return `new Promise((resolve) => {
    const intervals = [];
    let previous = performance.now();
    const start = previous;
    function tick(now) {
      intervals.push(now - previous);
      previous = now;
      if (now - start < ${windowMs}) {
        requestAnimationFrame(tick);
      } else {
        const total = intervals.reduce((sum, value) => sum + value, 0);
        resolve({ frames: intervals.length, average: total / intervals.length, slowest: Math.max(...intervals) });
      }
    }
    requestAnimationFrame(tick);
  })`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
