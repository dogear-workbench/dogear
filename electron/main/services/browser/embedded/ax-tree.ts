import type { EmbeddedPageState } from './types.js';

export const AX_OBSERVE_DEPTH = 10;
export const AX_FIND_DEPTH = 16;
export const MAX_INTERACTIVE_ELEMENTS = 250;
export const MAX_HEADING_ELEMENTS = 60;
export const MAX_ROLE_SUMMARY_ITEMS = 12;
const INTERACTIVE_NAME_LIMIT = 160;
const CONTEXT_NAME_LIMIT = 80;
const SUMMARY_SAMPLE_LIMIT = 120;

const INTERACTIVE_AX_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

const NOISE_AX_ROLES = new Set(['generic', 'none', 'ignored', 'InlineTextBox', 'LineBreak']);

export type ObserveRegion = 'top' | 'middle' | 'bottom';

export interface ObserveElement {
  ref: string;
  role: string;
  text: string;
  hint: string;
  href?: string;
  level?: number;
  editable: boolean;
  interactive: boolean;
}

export interface RoleSummary {
  role: string;
  count: number;
  totalChars: number;
  sample: string;
}

export interface DomFallbackLink {
  text: string;
  href: string;
}

export interface ObservePayload {
  tabId: string;
  url: string;
  title: string;
  generation: number;
  pageState: EmbeddedPageState;
  totalInteractive: number;
  shownInteractive: number;
  regionCounts: Record<ObserveRegion, number>;
  elements: ObserveElement[];
  headings: ObserveElement[];
  roleSummary: RoleSummary[];
  truncated: boolean;
  /** AX 可交互元素过少时的 DOM a[href] 兜底（无 ref，不可 click） */
  domFallbackLinks?: DomFallbackLink[];
}

export interface FindPayload {
  tabId: string;
  url: string;
  title: string;
  generation: number;
  pageState: EmbeddedPageState;
  elements: ObserveElement[];
}

export interface AxNodeSummary {
  backendNodeId: number;
  role: string;
  name: string;
  hint: string;
  href?: string;
  editable: boolean;
  interactive: boolean;
  headingLevel?: number;
  box?: { x: number; y: number; width: number; height: number };
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'value' in value && typeof (value as { value: unknown }).value === 'string') {
    return ((value as { value: string }).value).trim();
  }
  return '';
}

function axProperties(ax: Record<string, unknown>): Array<Record<string, unknown>> {
  const properties = ax.properties;
  return Array.isArray(properties) ? (properties as Array<Record<string, unknown>>) : [];
}

function axPropertyString(ax: Record<string, unknown>, propertyName: string): string {
  for (const property of axProperties(ax)) {
    if (property && (property as Record<string, unknown>).name === propertyName) {
      return textValue((property as Record<string, unknown>).value);
    }
  }
  return '';
}

function axPropertyEditable(ax: Record<string, unknown>): boolean {
  for (const property of axProperties(ax)) {
    const record = property as Record<string, unknown>;
    if (!record || record.name !== 'editable') continue;
    const value = (record.value as { value?: unknown } | undefined)?.value;
    if (value === true) return true;
    if (typeof value === 'string' && value !== '' && value !== 'false') return true;
  }
  return false;
}

function isEditableAxNode(role: string, ax: Record<string, unknown>): boolean {
  return role === 'textbox' || role === 'searchbox' || axPropertyEditable(ax);
}

export function isInteractiveAxRole(role: string): boolean {
  return INTERACTIVE_AX_ROLES.has(role.toLowerCase());
}

function nameLimitFor(role: string): number {
  return isInteractiveAxRole(role) ? INTERACTIVE_NAME_LIMIT : CONTEXT_NAME_LIMIT;
}

/** CDP Accessibility.getFullAXTree 的 nodes 原样透传，此处只做结构与类型归一 */
export function collectAxCandidates(nodes: unknown[]): AxNodeSummary[] {
  const candidates: AxNodeSummary[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const ax = node as Record<string, unknown>;
    if (ax.ignored === true) continue;
    const backendNodeId = typeof ax.backendDOMNodeId === 'number' ? ax.backendDOMNodeId : 0;
    if (!backendNodeId) continue;
    const role = textValue(ax.role);
    if (!role || NOISE_AX_ROLES.has(role)) continue;
    const name = textValue(ax.name);
    const editable = isEditableAxNode(role, ax);
    const interactive = editable || isInteractiveAxRole(role);
    if (!interactive && !name) continue;
    const hint = axPropertyString(ax, 'placeholder') || axPropertyString(ax, 'description');
    const href = axPropertyString(ax, 'url') || undefined;
    const levelValue = Number(axPropertyString(ax, 'level'));
    candidates.push({
      backendNodeId,
      role: role.toLowerCase(),
      name: name.slice(0, nameLimitFor(role)),
      hint: hint.slice(0, CONTEXT_NAME_LIMIT),
      href,
      editable,
      interactive,
      headingLevel: role.toLowerCase() === 'heading' && Number.isFinite(levelValue) ? levelValue : undefined,
    });
  }
  return candidates;
}

export function summarizeByRole(candidates: AxNodeSummary[]): RoleSummary[] {
  const byRole = new Map<string, RoleSummary>();
  for (const candidate of candidates) {
    const existing = byRole.get(candidate.role);
    const chars = candidate.name.length;
    if (existing) {
      existing.count += 1;
      existing.totalChars += chars;
      if (chars > existing.sample.length) existing.sample = candidate.name;
    } else {
      byRole.set(candidate.role, {
        role: candidate.role,
        count: 1,
        totalChars: chars,
        sample: candidate.name.slice(0, SUMMARY_SAMPLE_LIMIT),
      });
    }
  }
  return [...byRole.values()].sort((a, b) => b.totalChars - a.totalChars).slice(0, MAX_ROLE_SUMMARY_ITEMS);
}

export function elementOf(candidate: AxNodeSummary, generation: number): ObserveElement {
  const element: ObserveElement = {
    ref: `${candidate.backendNodeId}@${generation}`,
    role: candidate.role,
    text: candidate.name,
    hint: candidate.hint,
    editable: candidate.editable,
    interactive: candidate.interactive,
  };
  if (candidate.href) element.href = candidate.href;
  if (candidate.headingLevel !== undefined) element.level = candidate.headingLevel;
  return element;
}
