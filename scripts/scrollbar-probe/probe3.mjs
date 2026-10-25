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

// 建立可靠 hover：先空白再移入，直到 hover=true
await move(450, 15);
for (let i = 0; i < 3; i++) {
  await move(150, 300);
  if (await evalJS(hoverState) === true) break;
}
console.log('hover 状态:', await evalJS(hoverState));

console.log('\n--- 各选择器形式下的 thumb 颜色（鼠标持续在容器上）---');
console.log('R1 *:hover      :', await evalJS(thumb));
console.log('R4 #sidebar:hover:', await evalJS(thumb));

console.log('\n--- R3 class+:hover ---');
await evalJS(`document.querySelector('#sidebar').classList.add('sb')`);
await new Promise((r) => setTimeout(r, 250));
console.log('R3 .sb:hover    :', await evalJS(thumb), '| hover:', await evalJS(hoverState));
await evalJS(`document.querySelector('#sidebar').classList.remove('sb')`);

console.log('\n--- R5 通配符无 hover（隔离通配符变量）---');
await evalJS(`document.querySelector('#sidebar').setAttribute('data-probe','on')`);
await new Promise((r) => setTimeout(r, 250));
console.log('R5 *[data-probe]:', await evalJS(thumb));
await evalJS(`document.querySelector('#sidebar').removeAttribute('data-probe')`);

ws.close();
process.exit(0);
