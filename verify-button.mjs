// End-to-end check for the workspace "Add workspace" button.
//
// Drives a separate headless Chromium/Brave over the DevTools Protocol, loads
// the authenticated DSH web GUI, clicks the sidebar add control, and reports
// whether the "Select Workspace Directory" dialog opened.
//
// Usage:
//   flatpak run com.brave.Browser --headless=new --remote-debugging-port=9222 \
//     --user-data-dir=/tmp/dsh-verify --remote-allow-origins='*' about:blank &
//   TOKEN=<web-token> node verify-button.mjs
//
// The token is the ?token= value printed by `dsh web` on startup.

const TOKEN = process.env.TOKEN;
const CDP = process.env.CDP ?? 'http://127.0.0.1:9222';
if (!TOKEN) throw new Error('set TOKEN to the dsh web ?token= value');

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('no page target on the CDP endpoint');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id === undefined) return;
  const settle = pending.get(message.id);
  if (settle === undefined) return;
  pending.delete(message.id);
  settle(message);
});

/** Send one CDP command and resolve its result. */
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => (message.error
      ? reject(new Error(`${method}: ${message.error.message}`))
      : resolve(message.result)));
  });
}

/** Evaluate an expression in the page and return its value. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`eval failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:3080/?token=${TOKEN}` });

const shellReady = await evaluate(`(async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (document.querySelector('[class*="frame"]')) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
})()`);

const report = await evaluate(`(async () => {
  const button = [...document.querySelectorAll('button')].find(candidate =>
    ((candidate.getAttribute('aria-label') || '') + ' ' + (candidate.getAttribute('title') || '') + ' ' + candidate.textContent)
      .toLowerCase().includes('add workspace'));
  if (button === undefined) return { clicked: false, reason: 'no "Add workspace" control found' };
  button.click();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog !== null) {
      return {
        clicked: true,
        dialogLabel: dialog.getAttribute('aria-label'),
        text: (dialog.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return { clicked: true, dialogLabel: null, reason: 'no dialog appeared within 8s' };
})()`);

console.log(JSON.stringify({ shellReady, ...report }, null, 2));
ws.close();
if (report.dialogLabel !== 'Select Workspace Directory') process.exitCode = 1;
