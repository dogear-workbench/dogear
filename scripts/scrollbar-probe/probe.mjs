const PORT = process.argv[2] || '9333';
const BASE = `http://127.0.0.1:${PORT}`;

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target', list);
  process.exit(1);
}

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
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});

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

async function probe(label) {
  const expr = `JSON.stringify({
    sidebarThumb: getComputedStyle(document.querySelector('#sidebar'), '::-webkit-scrollbar-thumb').backgroundColor,
    chatThumb: getComputedStyle(document.querySelector('#chat'), '::-webkit-scrollbar-thumb').backgroundColor,
    sidebarHover: document.querySelector('#sidebar').matches(':hover'),
    chatHover: document.querySelector('#chat').matches(':hover')
  })`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(label.padEnd(38), res.result.result.value);
}

console.log('--- 每步: thumb 实际渲染色 + 容器 hover 状态 (rgba(0,0,0,0)=透明) ---');
await probe('0 初始(未移动鼠标)');

await move(450, 15);
await probe('1 空白区(body padding)');

await move(150, 300);
await probe('2 左栏中央');

await move(550, 300);
await probe('3 聊天区中央');

await move(853, 300);
await probe('4 聊天区滚动条上');

await move(550, 300);
await probe('5 回聊天区中央');

await move(450, 15);
await probe('6 回空白区');

await move(150, 300);
await probe('7 再回左栏中央');

await move(450, 590);
await probe('8 底部空白区');

ws.close();
process.exit(0);
