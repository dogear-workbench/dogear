/**
 * 扩展通道页面命令的 payload 类型、解析与观察结果格式化
 */

export interface ObserveElement {
  ref: string;
  role: string;
  text: string;
  hint: string;
  href?: string;
  level?: number;
  editable?: boolean;
  interactive?: boolean;
  visible?: boolean;
}

export interface RoleSummaryItem {
  role: string;
  count: number;
  totalChars: number;
  sample: string;
}

export interface PageMeta {
  tabId?: number;
  url?: string;
  title?: string;
  generation?: number;
  pageState?: string;
}

export interface ObservePayload extends PageMeta {
  totalInteractive: number;
  shownInteractive: number;
  regionCounts: { top: number; middle: number; bottom: number };
  elements: ObserveElement[];
  headings: ObserveElement[];
  roleSummary: RoleSummaryItem[];
  truncated: boolean;
}

export interface FindPayload extends PageMeta {
  elements: ObserveElement[];
}

export interface ScrollPosition {
  top: number;
  height: number;
  clientHeight: number;
}

export interface ScrollPayload extends PageMeta {
  target?: string;
  before?: ScrollPosition;
  after?: ScrollPosition;
  moved?: boolean;
}

export interface ClickPayload {
  urlBefore?: string;
  urlAfter?: string;
  elementGone?: boolean;
  textBefore?: number;
  textAfter?: number;
  clicked?: boolean;
  navigated?: boolean;
  verification?: string;
  openedTab?: { tabId?: number; url?: string; title?: string };
  targetHidden?: boolean;
}

export interface ReadTextPayload {
  text?: string;
  totalLength?: number;
  tabId?: number;
  pageState?: string;
}

export interface ReadStatePayload {
  missing?: boolean;
  notFound?: boolean;
  availableKeys?: unknown[];
  notSerializable?: boolean;
  summary?: string;
  json?: string;
  truncated?: boolean;
  totalLength?: number;
}

export interface WaitForPayload extends PageMeta {
  matched?: boolean;
}

export interface ReadArticlePayload {
  html?: string;
  containerHtml?: string;
  url?: string;
  title?: string;
  tabId?: number;
  pageState?: string;
}

function parsePageMeta(raw: Partial<PageMeta>): PageMeta {
  return {
    ...(typeof raw.tabId === 'number' ? { tabId: raw.tabId } : {}),
    ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.generation === 'number' ? { generation: raw.generation } : {}),
    ...(typeof raw.pageState === 'string' && raw.pageState ? { pageState: raw.pageState } : {}),
  };
}

function parseElements(source: unknown): ObserveElement[] {
  if (!Array.isArray(source)) return [];
  return source.filter(
    (el): el is ObserveElement =>
      !!el && typeof el === 'object' && typeof (el as ObserveElement).ref === 'string',
  );
}

export function parseObservePayload(data: unknown): ObservePayload {
  const raw = (data ?? {}) as Partial<ObservePayload>;
  const elements = parseElements(raw.elements);
  const counts = (raw.regionCounts ?? {}) as Partial<ObservePayload['regionCounts']>;
  const roleSummary = Array.isArray(raw.roleSummary) ? raw.roleSummary : [];
  return {
    ...parsePageMeta(raw),
    totalInteractive: typeof raw.totalInteractive === 'number' ? raw.totalInteractive : elements.length,
    shownInteractive: typeof raw.shownInteractive === 'number' ? raw.shownInteractive : elements.length,
    regionCounts: {
      top: typeof counts.top === 'number' ? counts.top : 0,
      middle: typeof counts.middle === 'number' ? counts.middle : 0,
      bottom: typeof counts.bottom === 'number' ? counts.bottom : 0,
    },
    elements,
    headings: parseElements(raw.headings),
    roleSummary: roleSummary.filter(
      (item): item is RoleSummaryItem =>
        !!item && typeof item === 'object' && typeof (item as RoleSummaryItem).role === 'string',
    ),
    truncated: raw.truncated === true,
  };
}

export function parseFindPayload(data: unknown): FindPayload {
  const raw = (data ?? {}) as Partial<FindPayload>;
  return { ...parsePageMeta(raw), elements: parseElements(raw.elements) };
}

/** 非常规 pageState 的输出尾注（ready 不打扰）；登录/验证墙已由 loginWallGate 弹卡，此处只描述机制不虚构状态 */
export function pageStateSuffix(pageState?: string): string {
  if (!pageState || pageState === 'ready') return '';
  if (pageState === 'login_required' || pageState === 'verification_required') {
    return pageState === 'login_required'
      ? '\n⚠️ 页面处于登录墙，自动操作无法继续；已弹出等待人工卡（会话消息流内），请引导用户处理；用户跳过或超时后按返回指引换源并如实告知，不要反复自动重试'
      : '\n⚠️ 页面处于人机验证/挑战页，自动操作无法继续；已弹出等待人工卡（会话消息流内），请引导用户处理；用户跳过或超时后按返回指引换源并如实告知，不要反复自动重试';
  }
  const hint = pageStateHint(pageState);
  return hint ? `\n⚠️ ${hint}` : `\n页面状态: ${pageState}`;
}

/** 非常规状态给 agent 的下一步引导（登录/验证墙已在 pageStateSuffix 单独分支，不会走到） */
function pageStateHint(state: string): string | null {
  if (state === 'rate_limited') {
    return '页面疑似触发访问频率限制，请停止自动操作并等待，或告知用户人工处理';
  }
  if (state === 'crashed') {
    return '页面渲染进程已退出，请重新导航后操作';
  }
  return null;
}

export function formatObserveElement(el: ObserveElement): string {
  const text = el.text ? `"${el.text}"` : '（无文本）';
  const hint = el.hint ? ` hint="${el.hint}"` : '';
  const href = el.href ? ` href="${el.href}"` : '';
  const level = el.level !== undefined ? `(level=${el.level})` : '';
  const editable = el.editable ? ' [可输入]' : '';
  const hidden = el.visible === false ? ' [隐藏]' : '';
  return `[${el.ref}] ${el.role}${level} ${text}${hint}${href}${editable}${hidden}`;
}

export function formatObserve(payload: ObservePayload): string {
  const sections: string[] = [
    `页面观察（DOM 语义树）\nURL: ${payload.url ?? ''}\n标题: ${payload.title ?? ''}\n状态: ${payload.pageState ?? 'ready'}${payload.generation !== undefined ? `（generation ${payload.generation}）` : ''}`,
  ];
  if (payload.elements.length === 0) {
    sections.push('可交互元素：无匹配（可传 text_filter 缩小范围重查，或用 find 按 role+name 查找）。');
  } else {
    let header = `可交互元素（共 ${payload.totalInteractive} 个）：`;
    if (payload.truncated) {
      header =
        `可交互元素（显示前 ${payload.shownInteractive} 个 / 共 ${payload.totalInteractive} 个，超出安全上限）：\n` +
        `可传 region="top"|"middle"|"bottom"（各区域元素数：top ${payload.regionCounts.top} / middle ${payload.regionCounts.middle} / bottom ${payload.regionCounts.bottom}）或 text_filter 缩小范围重查；也可用 find 按 role+name 精确查找。`;
    }
    sections.push(`${header}\n${payload.elements.map(formatObserveElement).join('\n')}`);
  }
  if (payload.headings.length > 0) {
    sections.push(`标题结构（页面骨架）：\n${payload.headings.map(formatObserveElement).join('\n')}`);
  }
  if (payload.roleSummary.length > 0) {
    const summary = payload.roleSummary
      .map((item) => `${item.role}×${item.count}（共 ${item.totalChars} 字${item.sample ? `，示例"${item.sample}"` : ''}）`)
      .join('；');
    sections.push(`其余语义节点摘要（按文本量排序）：${summary}`);
  }
  sections.push(
    'click / fill / scroll / read_text 请使用上面的 ref 编号定位元素；也可用 find 按 role+name 精确查找；页面导航后 ref 失效，需重新调用本工具。',
  );
  return sections.join('\n\n');
}
