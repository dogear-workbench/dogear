const PORT = process.argv[2] || '9333';
const BASE = `http://127.0.0.1:${PORT}`;

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

const thumb = `getComputedStyle(document.querySelector('#sidebar'), '::-webkit-scrollbar-thumb').backgroundColor`;
const hoverState = `document.querySelector('#sidebar').matches(':hover')`;

await send('Page.bringToFront').catch(() => {});
await send('Page.enable').catch(() => {});

console.log('=== 样式表与 app 完全一致（只有 *:hover 两条），复现用户操作序列 ===\n');

await move(450, 15);
console.log('A 鼠标在空白区            hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

await move(150, 300);
console.log('B 鼠标在 sidebar 中央      hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

await move(254, 300);
console.log('C 鼠标移到 thumb 上(右缘)  hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

await move(150, 300);
console.log('D 移回 sidebar 中央        hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

await move(450, 15);
console.log('E 移到空白区(容器外)       hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

await move(550, 300);
console.log('F 移到 chat 区(sidebar 外) hover=', await evalJS(hoverState), '| thumb =', await evalJS(thumb));

ws.close();
process.exit(0);
