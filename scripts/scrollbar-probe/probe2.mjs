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
  await new Promise((r) => setTimeout(r, 350));
}

async function evalJS(expr) {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res.result.result.value;
}

const thumbColor = `getComputedStyle(document.querySelector('#sidebar'), '::-webkit-scrollbar-thumb').backgroundColor`;

console.log('--- 三组规则对比（sidebar 容器）---');
console.log('R1 *:hover (现行) / R2 .show 类切换 / R3 .sb:hover 类+hover');

await move(150, 300);
console.log('鼠标在 sidebar 上, hover=', await evalJS(`document.querySelector('#sidebar').matches(':hover')`));
console.log('  R1 *:hover   :', await evalJS(thumbColor));

console.log('  加 .show 类后:');
await evalJS(`document.querySelector('#sidebar').classList.add('show')`);
await new Promise((r) => setTimeout(r, 200));
console.log('  R2 类切换    :', await evalJS(thumbColor));
await evalJS(`document.querySelector('#sidebar').classList.remove('show')`);

console.log('  加 .sb 类后(鼠标仍在容器上):');
await evalJS(`document.querySelector('#sidebar').classList.add('sb')`);
await new Promise((r) => setTimeout(r, 200));
console.log('  R3 类+:hover :', await evalJS(thumbColor));
await evalJS(`document.querySelector('#sidebar').classList.remove('sb')`);

console.log('\n--- 鼠标移走后复查 R3（加 .sb，鼠标在外）---');
await move(450, 15);
await evalJS(`document.querySelector('#sidebar').classList.add('sb')`);
await new Promise((r) => setTimeout(r, 200));
console.log('  R3 类+:hover(鼠标在外):', await evalJS(thumbColor));
await evalJS(`document.querySelector('#sidebar').classList.remove('sb')`);

ws.close();
process.exit(0);
