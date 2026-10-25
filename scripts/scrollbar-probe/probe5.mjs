const PORT = process.argv[2] || '9333';
const BASE = `http://127.0.0.1:${PORT}`;
const fs = await import('node:fs');

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function move(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await new Promise((r) => setTimeout(r, 400));
}

async function evalJS(expr) {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res.result.result.value;
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${__dirname}/${name}.png`, Buffer.from(res.result.data, 'base64'));
  console.log('saved', name + '.png');
}

await send('Page.bringToFront').catch(() => {});
await send('Page.enable').catch(() => {});

await move(450, 15);
await move(150, 300);
console.log('B 鼠标在 sidebar 中央, hover =', await evalJS(`document.querySelector('#sidebar').matches(':hover')`));
await shot('shotB-hover-center');

await move(254, 300);
console.log('C 鼠标在 thumb 上');
await shot('shotC-on-thumb');

await move(450, 15);
console.log('D 鼠标移到空白区');
await shot('shotD-outside');

await evalJS(`document.querySelector('#sidebar').classList.add('show')`);
await new Promise((r) => setTimeout(r, 250));
console.log('E .show 类切换 (对照)');
await shot('shotE-class');

ws.close();
process.exit(0);
