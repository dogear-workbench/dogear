/**
 * 正文路径可点：识别文本节点中的「多段相对路径且末段带扩展名」（如 docs/plans/xx/plan.md），
 * 加 Decoration 高亮（不改文档内容，保存的 md 原样）；点击行为由 TiptapEditor 的 handleClick 分流。
 *
 * 识别规则：
 * - 至少两段（含 1 个 `/`）、末段带字母扩展名；起点前不能是词字符/冒号/斜杠/点/横线
 *   （lookbehind 自动排除 http(s):// 内部片段与中英文粘连前缀）
 * - 排除所有段都为纯数字日期的路径（如 2026/09/29.md）
 * - 已带 link mark 的文本（markdown 显式链接）不重复高亮
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProsemirrorNode } from '@tiptap/pm/model';

export const notePathPluginKey = new PluginKey<DecorationSet>('notePathLink');

/**
 * 相对路径：至少一个「段/」，末段带 1-8 位字母开头扩展名。
 * 中间目录段限 ASCII（防中英文粘连吞前缀），末段（文件名）放开 Unicode 字母数字；
 * 空格不属段字符（词边界信号，含空格路径用 markdown 链接表达）
 */
const PATH_RE = /(?<![\w:/.-])(?:[\w.-]+\/)+[\w.\-\p{L}\p{N}]+\.[A-Za-z]\w{0,7}(?!\w)/gu;

/** 纯数字日期段（含 2026-09 / 2026.09.29 形态） */
const DATE_SEG_RE = /^\d+([.-]\d+)*$/;

/** 剥掉末尾扩展名后所有段都是纯数字日期 → 整条是日期串不是路径 */
function isAllDateSegments(path: string): boolean {
  return path.split('/').every((seg) => {
    const base = seg.replace(/\.[A-Za-z]\w{0,7}$/, '');
    return base === '' || DATE_SEG_RE.test(base);
  });
}

function findPathRanges(text: string): Array<{ start: number; end: number; path: string }> {
  const ranges: Array<{ start: number; end: number; path: string }> = [];
  for (const match of text.matchAll(PATH_RE)) {
    const candidate = match[0];
    if (isAllDateSegments(candidate)) continue;
    const index = match.index ?? 0;
    ranges.push({ start: index, end: index + candidate.length, path: candidate });
  }
  return ranges;
}

function buildPathDecorations(doc: ProsemirrorNode): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    // 显式 link mark 的文本交给 Link 扩展渲染，不重复加路径高亮
    if (node.marks.some((m) => m.type.name === 'link')) return;
    for (const range of findPathRanges(node.text)) {
      decorations.push(
        Decoration.inline(
          pos + range.start,
          pos + range.end,
          { class: 'note-path-link' },
          { path: range.path },
        ),
      );
    }
  });
  return decorations;
}

export const NotePathLink = Extension.create({
  name: 'notePathLink',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: notePathPluginKey,
        state: {
          init: (_, state) => DecorationSet.create(state.doc, buildPathDecorations(state.doc)),
          apply: (tr, value) =>
            tr.docChanged
              ? DecorationSet.create(tr.doc, buildPathDecorations(tr.doc))
              : value.map(tr.mapping, tr.doc),
        },
        props: {
          decorations(state) {
            return notePathPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** 取点击位置覆盖的路径高亮（来自 NotePathLink 的 Decoration spec） */
export function getDecoratedPathAt(state: EditorState, pos: number): string | null {
  const set = notePathPluginKey.getState(state);
  if (!set) return null;
  const found = set.find(pos, pos, (d) => typeof d.spec?.path === 'string');
  return (found[0]?.spec.path as string | undefined) ?? null;
}

/** 取点击位置所在 link mark 的 href（markdown 显式链接） */
export function getLinkHrefAt(state: EditorState, pos: number): string | null {
  const mark = state.doc.resolve(pos).marks().find((m) => m.type.name === 'link');
  return (mark?.attrs.href as string | undefined) ?? null;
}
