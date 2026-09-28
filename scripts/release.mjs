import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { killBlockingProcesses } from './kill-processes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'out');
const RELEASE_DIR = path.join(ROOT, 'release');
const UPDATE_SERVER_DIR = path.join(ROOT, 'update-server');
const STATE_FILE = path.join(ROOT, '.release-state.json');
const SERVER_URL = 'http://localhost:9527';
const PLATFORM = process.platform;

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  parts[2] += 1;
  return parts.join('.');
}

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

async function getAllFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

// electron-builder 的打包输入（图标/安装器脚本/配置）不进 dist/，但变了必须全量——热更 zip 覆盖不到 exe 内嵌资源
const BUNDLE_INPUTS = [
  'build/icon.ico',
  'build/icon.icns',
  'build/icon-tray.png',
  'build/installer.nsh',
  'electron-builder.yml',
];

async function hashDir(dirPath) {
  const files = await getAllFiles(dirPath);
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(dirPath, file).replace(/\\/g, '/'));
    hash.update(await fs.readFile(file));
  }
  return hash.digest('hex');
}

async function hashBundle() {
  const hash = crypto.createHash('sha256');
  hash.update(await hashDir(DIST_DIR));
  for (const rel of BUNDLE_INPUTS) {
    hash.update(rel);
    hash.update(await fs.readFile(path.join(ROOT, rel)));
  }
  return hash.digest('hex');
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function zipDir(srcDir, zipPath, version) {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.addFile('.hotfix-version', Buffer.from(version));
  zip.writeZip(zipPath);
}

async function loadExistingManifest() {
  try {
    return JSON.parse(await fs.readFile(path.join(UPDATE_SERVER_DIR, 'manifest.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function toPlatformRelease(entry) {
  const release = { version: entry.version, type: entry.type, pubDate: entry.pubDate };
  if (entry.hotfix) release.hotfix = entry.hotfix;
  if (entry.full) release.full = entry.full;
  return release;
}

async function writePlatformManifest(platform, release) {
  const existing = await loadExistingManifest();
  const platforms = { ...(existing?.platforms ?? {}) };
  if (!platforms.win32 && existing && (existing.hotfix || existing.full)) {
    platforms.win32 = toPlatformRelease(existing);
  }
  platforms[platform] = release;

  // 顶层扁平字段固定镜像 win32，旧客户端（只读顶层）拿到的始终是 win 产物
  const winRelease = platforms.win32;
  const manifest = {
    version: winRelease ? winRelease.version : release.version,
    pubDate: winRelease ? winRelease.pubDate : release.pubDate,
    platforms,
  };
  if (winRelease) {
    manifest.type = winRelease.type;
    if (winRelease.hotfix) manifest.hotfix = winRelease.hotfix;
    if (winRelease.full) manifest.full = winRelease.full;
  }

  await fs.writeFile(
    path.join(UPDATE_SERVER_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

async function main() {
  console.log('\n▶ 清理占用进程...');
  killBlockingProcesses();

  const pkgRaw = await fs.readFile(PACKAGE_JSON, 'utf-8');
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version;
  const newVersion = bumpPatch(oldVersion);
  pkg.version = newVersion;
  await fs.writeFile(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`版本号: ${oldVersion} → ${newVersion}`);

  run('bun run build:electron', '编译主进程 → dist/');
  run('bun run build:renderer', '构建前端 → out/');

  const distHash = await hashBundle();
  console.log(`\ndist/ hash: ${distHash.slice(0, 16)}…`);

  let prevState = null;
  try {
    prevState = JSON.parse(await fs.readFile(STATE_FILE, 'utf-8'));
  } catch {}

  const isFirstRelease = !prevState;
  const distChanged = isFirstRelease || prevState.distHash !== distHash;

  await fs.mkdir(UPDATE_SERVER_DIR, { recursive: true });

  let releaseType;

  if (!distChanged) {
    releaseType = 'hotfix';
    console.log('\n✦ dist/ 未变化 → 热更新路径');

    const zipName = PLATFORM === 'darwin' ? `update-${newVersion}-mac.zip` : `update-${newVersion}.zip`;
    const zipPath = path.join(UPDATE_SERVER_DIR, zipName);

    await zipDir(OUT_DIR, zipPath, newVersion);
    const zipSize = (await fs.stat(zipPath)).size;
    const zipHash = await sha256File(zipPath);

    await writePlatformManifest(PLATFORM, {
      version: newVersion,
      type: 'hotfix',
      pubDate: new Date().toISOString(),
      hotfix: {
        url: `${SERVER_URL}/${zipName}`,
        size: zipSize,
        sha256: zipHash,
      },
    });
    console.log(`  ✓ ${zipName} (${(zipSize / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    releaseType = 'full';
    console.log(`\n✦ ${isFirstRelease ? '首次发布' : 'dist/ 已变化'} → 全量路径`);

    await fs.mkdir(RELEASE_DIR, { recursive: true });
    run('bun run dist', '全量打包 (electron-builder)');

    if (PLATFORM === 'darwin') {
      for (const old of await fs.readdir(UPDATE_SERVER_DIR)) {
        if (old.endsWith('.dmg') || old.endsWith('-mac.zip') || old === 'latest-mac.yml') {
          await fs.unlink(path.join(UPDATE_SERVER_DIR, old)).catch(() => {});
        }
      }

      const releaseFiles = await fs.readdir(RELEASE_DIR);
      const dmgFile = releaseFiles.find(f => f.endsWith('.dmg') && f.includes(newVersion));
      if (!dmgFile) throw new Error(`release/ 中未找到 v${newVersion} 的 .dmg 文件`);
      const dmgDst = path.join(UPDATE_SERVER_DIR, dmgFile);
      await fs.copyFile(path.join(RELEASE_DIR, dmgFile), dmgDst);
      const dmgSize = (await fs.stat(dmgDst)).size;
      const dmgHash = await sha256File(dmgDst);

      const zipFile = releaseFiles.find(f => f.endsWith('-mac.zip') && f.includes(newVersion));
      if (zipFile) {
        await fs.copyFile(path.join(RELEASE_DIR, zipFile), path.join(UPDATE_SERVER_DIR, zipFile));
      }
      const ymlFile = releaseFiles.find(f => f === 'latest-mac.yml');
      if (ymlFile) {
        await fs.copyFile(path.join(RELEASE_DIR, ymlFile), path.join(UPDATE_SERVER_DIR, ymlFile));
      }

      await writePlatformManifest('darwin', {
        version: newVersion,
        type: 'full',
        pubDate: new Date().toISOString(),
        full: {
          url: `${SERVER_URL}/${encodeURIComponent(dmgFile)}`,
          size: dmgSize,
          sha256: dmgHash,
        },
      });
      console.log(`  ✓ ${dmgFile} (${(dmgSize / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      for (const old of await fs.readdir(UPDATE_SERVER_DIR)) {
        if (old.endsWith('.exe') || old.endsWith('.exe.blockmap') || old === 'latest.yml') {
          await fs.unlink(path.join(UPDATE_SERVER_DIR, old)).catch(() => {});
        }
      }

      const releaseFiles = await fs.readdir(RELEASE_DIR);
      const exeFile = releaseFiles.find(
        f => f.endsWith('.exe') && !f.endsWith('.blockmap') && f.includes(newVersion),
      );
      if (!exeFile) throw new Error(`release/ 中未找到 v${newVersion} 的 .exe 文件`);

      const exeSrc = path.join(RELEASE_DIR, exeFile);
      const exeDst = path.join(UPDATE_SERVER_DIR, exeFile);
      await fs.copyFile(exeSrc, exeDst);

      const exeSize = (await fs.stat(exeDst)).size;
      const exeHash = await sha256File(exeDst);

      const blockmapFile = releaseFiles.find(
        f => f.endsWith('.exe.blockmap') && f.includes(newVersion),
      );
      if (blockmapFile) {
        await fs.copyFile(
          path.join(RELEASE_DIR, blockmapFile),
          path.join(UPDATE_SERVER_DIR, blockmapFile),
        );
      }
      const ymlFile = releaseFiles.find(f => f === 'latest.yml');
      if (ymlFile) {
        await fs.copyFile(
          path.join(RELEASE_DIR, ymlFile),
          path.join(UPDATE_SERVER_DIR, ymlFile),
        );
      }

      await writePlatformManifest('win32', {
        version: newVersion,
        type: 'full',
        pubDate: new Date().toISOString(),
        full: {
          url: `${SERVER_URL}/${encodeURIComponent(exeFile)}`,
          size: exeSize,
          sha256: exeHash,
        },
      });
      console.log(`  ✓ ${exeFile} (${(exeSize / 1024 / 1024).toFixed(2)} MB)`);
    }
  }

  await fs.writeFile(
    STATE_FILE,
    JSON.stringify({
      distHash,
      version: newVersion,
      type: releaseType,
      timestamp: new Date().toISOString(),
    }, null, 2),
  );

  console.log(`\n✓ 发布完成: v${newVersion} (${releaseType})`);
  console.log(`  产物目录: ${UPDATE_SERVER_DIR}`);
  console.log(`  启动服务: bun run serve-updates`);
}

main().catch(err => {
  console.error('\n✗ 发布失败:', err.message);
  process.exit(1);
});
