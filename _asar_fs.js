
}
/**
 * 工作区文件系统服务
 * 文件树操作（扫描/创建/重命名/移动/复制/删除）限定在主根内；
 * 读盘与存在性检查（readWorkspaceTextFile/checkPathsExist）接受多根（主根 + enabled 附加根），
 * 与 agent 侧 allowedPaths 语义对齐，防止越权访问
 */
import fs from 'fs/promises';
import path from 'path';
import { takeSnapshot } from './git-service/index.js';
/** fire-and-forget：快照失败不阻塞原操作（无 git 时 takeSnapshot 静默跳过） */
function snapshotAfterUi(workspaceId, workspacePath, source, relPath) {
    if (!workspaceId)
        return;
    takeSnapshot(workspaceId, workspacePath, source, toPosix(relPath)).catch((error) => {
        console.warn(`[git-snapshot] ${source} 快照失败:`, error);
    });
}
function toPosix(p) {
    return p.replace(/\\/g, '/');
}
/** 隐藏的目录/文件名（不在文件树中显示） */
const HIDDEN_NAMES = ['.dogear', '.DS_Store', 'Thumbs.db', '.git'];
/** resolved 是否落在 root 内；前缀统一补路径分隔符，防兄弟目录前缀碰撞（C:\ws2 以 C:\ws 开头） */
function isWithinRoot(root, resolved) {
    const normalizedRoot = path.normalize(root);
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return resolved === normalizedRoot || resolved.startsWith(prefix);
}
/**
 * 路径安全校验：确保目标路径在工作区范围内
 * @param workspacePath - 工作区绝对路径
 * @param relativePath - 待校验的相对路径
 * @returns 校验通过的绝对路径
 * @throws 路径越权时抛出错误
 */
export function resolveAndValidate(workspacePath, relativePath) {
    const resolved = path.resolve(workspacePath, relativePath);
    const normalized = path.normalize(resolved);
    if (!isWithinRoot(workspacePath, normalized)) {
        throw new Error('路径越权：不允许访问工作区外的文件');
    }
    return normalized;
}
/**
 * 候选路径（相对/绝对）逐根解析，命中任一根内即返回该绝对路径，全部不命中返回 null。
 * 相对路径按 roots 顺序优先落在首根（主根），与 agent 侧 resolveWithinPaths 语义一致
 */
export function resolveWithinRoots(roots, candidate) {
    for (const root of roots) {
        if (!root)
            continue;
        const resolved = path.normalize(path.resolve(root, candidate));
        if (isWithinRoot(root, resolved))
            return resolved;
    }
    return null;
}
/**
 * 逐根解析且要求真实存在：前缀解析会被主根遮蔽（任何相对路径都落在主根内），
 * 存在性场景（读盘/胶囊校验）必须逐根 stat 直到命中，否则后位根（组共享区等）永远轮不到
 */
async function resolveExistingWithinRoots(roots, candidate) {
    for (const root of roots) {
        if (!root)
            continue;
        const resolved = path.normalize(path.resolve(root, candidate));
        if (!isWithinRoot(root, resolved))
            continue;
        try {
            await fs.stat(resolved);
            return resolved;
        }
        catch {
            continue;
        }
    }
    return null;
}
/**
 * 批量存在性校验：仅对落在 roots 内的路径做 stat，根外路径一律 false（不泄露工作区外文件信息）
 * @returns 入参 path → 是否存在
 */
export async function checkPathsExist(roots, paths) {
    const result = {};
    for (const candidate of paths) {
        result[candidate] = (await resolveExistingWithinRoots(roots, candidate)) !== null;
    }
    return result;
}
/**
 * 递归扫描工作区目录，构建文件树（排除隐藏目录）
 * excludedPaths 为快照排除清单（归一化相对路径），命中即剪掉整棵子树
 */
export async function scanWorkspaceFiles(workspacePath, excludedPaths) {
    return scanDirectory(workspacePath, workspacePath, excludedPaths);
}
/** 原地标注 git 未跟踪节点（?? 项：散文件或纯未跟踪目录折叠形式），命中即整棵子树归属该节点，不再深入 */
export function markUntrackedNodes(nodes, untrackedPaths) {
    for (const node of nodes) {
        if (untrackedPaths.has(node.path)) {
            node.gitStatus = 'untracked';
            continue;
        }
        if (node.type === 'directory' && node.children)
            markUntrackedNodes(node.children, untrackedPaths);
    }
}
/**
 * 递归扫描单个目录，返回该目录下的文件节点列表
 */
async function scanDirectory(dirPath, workspacePath, excludedPaths) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const nodes = [];
        for (const entry of entries) {
            // 跳过隐藏文件和目录
            if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.'))
                continue;
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, '/');
            if (excludedPaths?.has(relativePath))
                continue;
            if (entry.isDirectory()) {
                const children = await scanDirectory(fullPath, workspacePath);
                nodes.push({
                    name: entry.name,
                    path: relativePath,
                    type: 'directory',
                    children,
                });
            }
            else {
                const ext = path.extname(entry.name).toLowerCase();
                nodes.push({
                    name: entry.name,
                    path: relativePath,
                    type: 'file',
                    ext,
                });
            }
        }
        // 文件夹在前，文件在后，各自按名称排序
        nodes.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory')
                return -1;
            if (a.type !== 'directory' && b.type === 'directory')
                return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
        return nodes;
    }
    catch {
        return [];
    }
}
/**
 * 单层扫描目录（不递归），供已排除分区的惰性浏览：展开一层拉一层，children 留空由前端逐层拉取
 */
export async function scanDirectoryLevel(workspacePath, relPath) {
    const dirAbsPath = resolveAndValidate(workspacePath, relPath);
    try {
        const entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
        const nodes = [];
        for (const entry of entries) {
            if (HIDDEN_NAMES.includes(entry.name) || entry.name.startsWith('.'))
                continue;
            const childRelPath = path.relative(workspacePath, path.join(dirAbsPath, entry.name)).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                nodes.push({ name: entry.name, path: childRelPath, type: 'directory' });
            }
            else {
                nodes.push({ name: entry.name, path: childRelPath, type: 'file', ext: path.extname(entry.name).toLowerCase() });
            }
        }
        nodes.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory')
                return -1;
            if (a.type !== 'directory' && b.type === 'directory')
                return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });
        return nodes;
    }
    catch {
        return [];
    }
}
/**
 * 创建文件夹
 */
export async function createFolder(workspacePath, parentRelPath, name, workspaceId) {
    const parentAbsPath = resolveAndValidate(workspacePath, parentRelPath);
    const newFolderPath = path.join(parentAbsPath, name);
    // 二次校验新文件夹路径也在工作区内
    resolveAndValidate(workspacePath, path.relative(workspacePath, newFolderPath));
    await fs.mkdir(newFolderPath, { recursive: true });
    snapshotAfterUi(workspaceId, workspacePath, 'ui-create', path.relative(workspacePath, newFolderPath));
}
/**
 * 重命名文件或文件夹
 */
export async function renameItem(workspacePath, itemRelPath, newName, workspaceId) {
    const oldAbsPath = resolveAndValidate(workspacePath, itemRelPath);
    const newAbsPath = path.join(path.dirname(oldAbsPath), newName);
    // 校验重命名后的路径仍在工作区内
    resolveAndValidate(workspacePath, path.relative(workspacePath, newAbsPath));
    try {
        await fs.rename(oldAbsPath, newAbsPath);
    }
    catch (err) {
        if (err.code === 'EPERM') {
            await fs.cp(oldAbsPath, newAbsPath, { recursive: true });
            await fs.rm(oldAbsPath, { recursive: true, force: true });
        }
        else {
            throw err;
        }
    }
    snapshotAfterUi(workspaceId, workspacePath, 'ui-rename', path.relative(workspacePath, newAbsPath));
}
/**
 * 移动文件或文件夹
 */
export async function moveItem(workspacePath, sourceRelPath, targetFolderRelPath, workspaceId) {
    const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
    const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
    const itemName = path.basename(sourceAbsPath);
    const targetAbsPath = path.join(targetFolderAbsPath, itemName);
    // 校验目标路径在工作区内
    resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
    try {
        await fs.rename(sourceAbsPath, targetAbsPath);
    }
    catch (err) {
        // Windows 上 rename 可能因文件锁报 EPERM，用 copy + delete 作为 fallback
        if (err.code === 'EPERM') {
            await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
            await fs.rm(sourceAbsPath, { recursive: true, force: true });
        }
        else {
            throw err;
        }
    }
    snapshotAfterUi(workspaceId, workspacePath, 'ui-rename', path.relative(workspacePath, targetAbsPath));
}
/**
 * 复制文件或文件夹
 */
export async function copyItem(workspacePath, sourceRelPath, targetFolderRelPath, workspaceId) {
    const sourceAbsPath = resolveAndValidate(workspacePath, sourceRelPath);
    const targetFolderAbsPath = resolveAndValidate(workspacePath, targetFolderRelPath);
    const itemName = path.basename(sourceAbsPath);
    const targetAbsPath = path.join(targetFolderAbsPath, itemName);
    // 校验目标路径在工作区内
    resolveAndValidate(workspacePath, path.relative(workspacePath, targetAbsPath));
    await fs.cp(sourceAbsPath, targetAbsPath, { recursive: true });
    snapshotAfterUi(workspaceId, workspacePath, 'ui-create', path.relative(workspacePath, targetAbsPath));
}
/**
 * 删除文件或文件夹
 */
export async function deleteItem(workspacePath, itemRelPath, workspaceId) {
    const absPath = resolveAndValidate(workspacePath, itemRelPath);
    await fs.rm(absPath, { recursive: true, force: true });
    snapshotAfterUi(workspaceId, workspacePath, 'ui-delete', path.relative(workspacePath, absPath));
}
const ALLOWED_TEXT_EXT = ['.md', '.markdown', '.txt', '.json'];
export async function readWorkspaceTextFile(roots, relPath) {
    if (!resolveWithinRoots(roots, relPath)) {
        throw new Error('路径越权：不允许访问工作区外的文件');
    }
    const safePath = await resolveExistingWithinRoots(roots, relPath);
    if (!safePath) {
        throw new Error(`文件不存在: ${relPath}`);
    }
    const ext = path.extname(safePath).toLowerCase();
    if (!ALLOWED_TEXT_EXT.includes(ext)) {
        throw new Error(`不支持的文件类型: ${ext}`);
    }
    const stat = await fs.stat(safePath);
    if (stat.size > 5 * 1024 * 1024) {
        throw new Error('文件过大（>5MB），不支持预览');
    }
    return fs.readFile(safePath, 'utf-8');