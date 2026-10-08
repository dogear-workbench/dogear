import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function killDarwin(rootPath) {
  // dev electron 与已安装 app 的可执行路径（/Applications/Dogear.app/...）
  const pattern = [escapeRegExp(rootPath), 'Dogear\\.app/Contents/MacOS'].join('|');
  let pids;
  try {
    pids = execSync(`pgrep -f ${JSON.stringify(pattern)}`, { encoding: 'utf-8', stdio: 'pipe' })
      .split('\n')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
  } catch {
    return 0;
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  return pids.length;
}

function killByPath(imageName, rootPath) {
  const psScript = `
$root = $env:DOGEAR_KILL_ROOT
$procs = Get-CimInstance Win32_Process -Filter "Name='${imageName}'" |
  Where-Object { $_.ExecutablePath -like "$root*" }
$count = 0
foreach ($p in $procs) {
  try { Stop-Process -Id $p.ProcessId -Force; $count++ } catch {}
}
Write-Output $count
`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  try {
    const result = execSync(
      `powershell -NoProfile -EncodedCommand ${encoded}`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: { ...process.env, DOGEAR_KILL_ROOT: rootPath },
      },
    ).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

export function killBlockingProcesses() {
  let total = 0;

  if (process.platform === 'darwin') {
    total = killDarwin(ROOT);
    if (total > 0) {
      console.log(`  ✓ Dogear 相关进程 ×${total}`);
      console.log(`  共清理 ${total} 个进程，等待句柄释放...`);
      execSync('sleep 1', { stdio: 'ignore' });
    }
    return;
  }

  if (process.platform !== 'win32') {
    return;
  }

  const dogearCount = killByPath('Dogear.exe', ROOT);
  if (dogearCount > 0) {
    console.log(`  ✓ Dogear.exe ×${dogearCount}`);
    total += dogearCount;
  }

  const electronCount = killByPath('electron.exe', ROOT);
  if (electronCount > 0) {
    console.log(`  ✓ electron.exe ×${electronCount}`);
    total += electronCount;
  }

  if (total > 0) {
    console.log(`  共清理 ${total} 个进程，等待句柄释放...`);
    execSync('timeout /t 1 /nobreak >nul 2>&1', { stdio: 'ignore' });
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  console.log('\n🔄 清理占用进程...\n');
  killBlockingProcesses();
  console.log('\n✓ 完成\n');
}
