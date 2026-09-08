import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));

const profileDir = mkdtempSync(path.join(os.tmpdir(), 'dogear-step2-site-knowledge-'));
process.env.DOGEAR_CONFIG_DIR = profileDir;

register('./electron-hooks.mjs', pathToFileURL(path.join(here, 'electron-hooks.mjs')).href);

const { readSiteKnowledge, appendSiteFinding, hasSiteKnowledge, normalizeDomain } = await import(
  pathToFileURL(path.resolve(here, '../../dist/main/services/browser/site-knowledge-service.js')).href
);

let failures = 0;
let passes = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}${extra ? `（${extra}）` : ''}`);
  }
}

const knowledgeDir = () => path.join(profileDir, 'site-knowledge');
const today = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

check('N1 normalizeDomain 小写去 www', normalizeDomain('WWW.Example.COM') === 'example.com');
check('N2 normalizeDomain 非法字符拒绝', normalizeDomain('bad_domain!.com') === null);
check('N3 normalizeDomain 路径穿越拒绝', normalizeDomain('..') === null && normalizeDomain('a..b') === null);
check('N4 normalizeDomain URL 宽容输入', normalizeDomain('https://www.Zhihu.com/question/1') === 'zhihu.com');

const missing = readSiteKnowledge('no-such-domain.example');
check('R1 读不存在域 exists:false 空 content', missing.exists === false && missing.content === '');
check('R2 不存在域 hasSiteKnowledge false', hasSiteKnowledge('no-such-domain.example') === false);

const conv = 'conv-1234567890';
const first = appendSiteFinding('www.Example.com', '发现A：搜索结果在 state.search.feeds', conv);
check(
  'A1 首次追加 ok:true 非去重',
  first.ok === true && first.deduplicated === undefined && first.error === undefined,
  JSON.stringify(first),
);
check('A3 追加后 hasSiteKnowledge true（域名已规范化）', hasSiteKnowledge('example.com') === true);
const content = readSiteKnowledge('example.com');
check('A4 读档案 exists:true', content.exists === true);
check('A5 骨架含标题与两区', content.content.includes('# example.com 站点档案') && content.content.includes('## 正式地图（已验证）') && content.content.includes('## 探索发现（未验证，由会话追加）'));
check(
  'A6 追加行格式 [YYYY-MM-DD · id前8位]',
  content.content.includes(`- [${today()} · ${conv.slice(0, 8)}] 发现A：搜索结果在 state.search.feeds`),
  content.content,
);
const second = appendSiteFinding('example.com', '发现B：卡片字段在 noteCard 下', conv);
check('A7 第二条追加成功', second.ok === true);
const content2 = readSiteKnowledge('example.com');
check(
  'A8 两条发现均在发现区标题之后',
  content2.content.indexOf('## 探索发现') < content2.content.indexOf('发现A') &&
    content2.content.indexOf('发现A') < content2.content.indexOf('发现B'),
);

const tooLong = '超'.repeat(501);
const rejected = appendSiteFinding('example.com', tooLong, conv);
check(
  'L1 超长拒绝 ok:false 中文 error',
  rejected.ok === false && typeof rejected.error === 'string' && rejected.error.includes('500'),
  JSON.stringify(rejected),
);
check('L2 超长内容未写入文件', !readSiteKnowledge('example.com').content.includes('超超超'));
const empty = appendSiteFinding('example.com', '   ', conv);
check('L3 空白内容拒绝', empty.ok === false && typeof empty.error === 'string');

const dupConv = 'conv-duplicate-99';
appendSiteFinding('dedupe.example.com', '重复发现X', dupConv);
const dup = appendSiteFinding('dedupe.example.com', '重复发现X', dupConv);
check('D1 60s 内相同 finding 去重 deduplicated:true', dup.ok === true && dup.deduplicated === true, JSON.stringify(dup));
const dupCount = readSiteKnowledge('dedupe.example.com').content.split('重复发现X').length - 1;
check('D2 文件中仅一条', dupCount === 1, `count=${dupCount}`);
const otherConv = appendSiteFinding('dedupe.example.com', '重复发现X', 'conv-other-42');
check('D3 不同会话不受去重影响', otherConv.ok === true && otherConv.deduplicated === undefined);

const bigBody = `# big.example.com 站点档案\n\n${'汉'.repeat(5000)}\n`;
mkdirSync(knowledgeDir(), { recursive: true });
writeFileSync(path.join(knowledgeDir(), 'big.example.com.md'), bigBody, 'utf8');
const truncated = readSiteKnowledge('big.example.com');
check(
  'T1 超 8KB 截断：exists:true + 截断标记 + 长度受限',
  truncated.exists === true &&
    truncated.content.includes('已截断') &&
    truncated.content.length < bigBody.length,
);
check('T2 截断边界无乱码替代符', !truncated.content.includes('\uFFFD'));
check('T3 截断保留正文头部', truncated.content.includes('# big.example.com 站点档案'));

const bad = appendSiteFinding('bad_domain!.com', '测试', conv);
check('E1 非法域名追加拒绝 ok:false 中文 error', bad.ok === false && typeof bad.error === 'string' && bad.error.includes('域名不合法'));
check('E2 非法域名读取正常态', readSiteKnowledge('bad_domain!.com').exists === false);
check('E3 非法域名 hasSiteKnowledge false', hasSiteKnowledge('bad_domain!.com') === false);

writeFileSync(
  path.join(knowledgeDir(), 'manual.example.com.md'),
  '# manual.example.com 站点档案\n\n## 正式地图（已验证）\n- 手工维护条目\n',
  'utf8',
);
appendSiteFinding('manual.example.com', '手工档案的补充发现', conv);
const manual = readSiteKnowledge('manual.example.com').content;
check(
  'M1 无发现区标题的存量档案自动补标题',
  manual.includes('## 探索发现（未验证，由会话追加）') && manual.indexOf('手工维护条目') < manual.indexOf('手工档案的补充发现'),
);

rmSync(profileDir, { recursive: true, force: true });

console.log(`\n${passes} PASS / ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
