// tools/cdp.mjs — tiny headless-Chrome driver over the DevTools protocol (Node 22+ built-in WebSocket).
// Dev/test tool only; the app itself has no Node dependency.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, profileDir }) {
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--lang=es-MX',
  ], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 50 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!info) throw new Error('Chrome did not start');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : ok(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++seq;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function newPage({ width = 1280, height = 900, mobile = false } = {}) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const errors = [];
    const events = [];
    listeners.add((msg) => {
      if (msg.sessionId !== sessionId) return;
      events.push(msg);
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url || '')) errors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    });
    await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('Network.enable');
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true });

    const page = {
      errors, s,
      async eval(expr) {
        const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  in: ${expr.slice(0, 200)}`);
        return r.result.value;
      },
      async goto(url) {
        events.length = 0;
        await s('Page.navigate', { url });
        await page.waitLoad();
      },
      async waitLoad(timeout = 15000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          if (events.some((e) => e.method === 'Page.loadEventFired')) { await sleep(300); return; }
          await sleep(50);
        }
        throw new Error('load timeout');
      },
      async waitFor(expr, timeout = 10000) {
        const t0 = Date.now();
        let last;
        while (Date.now() - t0 < timeout) {
          try { last = await page.eval(expr); if (last) return last; } catch (e) { last = e.message; }
          await sleep(100);
        }
        throw new Error(`waitFor timeout: ${expr} (last: ${last})`);
      },
      async waitUrl(part, timeout = 10000) {
        return page.waitFor(`location.href.includes(${JSON.stringify(part)})`, timeout);
      },
      // Sets a value the way a user would (fires input/change), works for input, textarea, select.
      async fill(selector, value) {
        await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('no element ${selector.replace(/'/g, '')}');
          el.focus(); el.value = ${JSON.stringify(String(value))};
          el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
      },
      async click(selector) {
        await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('no element ${selector.replace(/'/g, '')}'); el.click(); })()`);
      },
      async text(selector) { return page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`); },
      async setFile(selector, path) {
        const { root } = await s('DOM.getDocument', { depth: -1 });
        const { nodeId } = await s('DOM.querySelector', { nodeId: root.nodeId, selector });
        await s('DOM.setFileInputFiles', { nodeId, files: [path] });
      },
      async offline(on) {
        await s('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      },
      async pdf(path) {
        const { data } = await s('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        writeFileSync(path, Buffer.from(data, 'base64'));
        return path;
      },
      async screenshot(path, { full = true } = {}) {
        let clip;
        if (full) {
          const m = await s('Page.getLayoutMetrics');
          clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 4000), scale: 1 };
        }
        const { data } = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
        writeFileSync(path, Buffer.from(data, 'base64'));
        return path;
      },
    };
    return page;
  }

  return {
    newPage,
    async close() { try { await send('Browser.close'); } catch { /* already gone */ } proc.kill(); },
  };
}
