import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type {
  Watchlist,
  StockQuote,
  KLineDataPoint,
  KLinePeriod,
  AdjustType,
  TimelinePoint,
  MoneyFlowPoint,
  StockSearchResult,
  RateLimiterStatus,
} from '@/types/stock';

interface StockState {
  // 自选股
  watchlist: Watchlist | null;
  loadingWatchlist: boolean;

  // 行情（Map 结构，key="market.code"）
  quotes: Map<string, StockQuote>;
  loadingQuotes: boolean;

  // 选中的股票
  selectedStock: { market: number; code: string } | null;

  // 个股详情
  currentQuote: StockQuote | null;
  klineData: KLineDataPoint[];
  timelineData: TimelinePoint[];
  moneyFlowData: MoneyFlowPoint[];
  loadingDetail: boolean;

  // K线参数
  klinePeriod: KLinePeriod;   // 默认 101 (日K)
  klineAdjust: AdjustType;    // 默认 1 (前复权)

  // 搜索
  searchResults: StockSearchResult[];
  searchLoading: boolean;

  // 限流器状态
  rateLimiterStatus: RateLimiterStatus | null;

  // Actions
  loadWatchlist: () => Promise<void>;
  addToWatchlist: (stock: { code: string; market: number; name: string }) => Promise<void>;
  removeFromWatchlist: (market: number, code: string) => Promise<void>;
  reorderWatchlist: (items: { market: number; code: string; sortOrder: number }[]) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  selectStock: (market: number, code: string) => Promise<void>;
  loadKLine: (period?: KLinePeriod, adjust?: AdjustType) => Promise<void>;
  loadTimeline: () => Promise<void>;
  loadMoneyFlow: () => Promise<void>;
  searchStocks: (keyword: string) => Promise<void>;
  clearSearch: () => void;
  loadRateLimiterStatus: () => Promise<void>;
}

/** 构造 quote Map 的 key */
const quoteKey = (market: number, code: string) => `${market}.${code}`;

export const useStockStore = create<StockState>((set, get) => ({
  // --- 初始状态 ---
  watchlist: null,
  loadingWatchlist: false,
  quotes: new Map(),
  loadingQuotes: false,
  selectedStock: null,
  currentQuote: null,
  klineData: [],
  timelineData: [],
  moneyFlowData: [],
  loadingDetail: false,
  klinePeriod: 101,
  klineAdjust: 1,
  searchResults: [],
  searchLoading: false,
  rateLimiterStatus: null,

  // --- Actions ---

  /** 加载自选股列表 */
  loadWatchlist: async () => {
    set({ loadingWatchlist: true });
    try {
      const res = await client['stock:getWatchlist'](undefined);
      if ('error' in res && res.error) {
        toast.error('加载自选股失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ watchlist: res.data });
      }
    } catch (error) {
      console.error('加载自选股失败:', error);
      toast.error('加载自选股失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loadingWatchlist: false });
    }
  },

  /** 添加自选股 */
  addToWatchlist: async (stock) => {
    try {
      const res = await client['stock:addToWatchlist'](stock);
      if ('error' in res && res.error) {
        toast.error('添加自选股失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ watchlist: res.data });
        toast.success(`已添加 ${stock.name}(${stock.code}) 到自选`);
        // 刷新行情数据
        get().refreshQuotes();
      }
    } catch (error) {
      console.error('添加自选股失败:', error);
      toast.error('添加自选股失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 删除自选股 */
  removeFromWatchlist: async (market, code) => {
    try {
      const res = await client['stock:removeFromWatchlist']({ market, code });
      if ('error' in res && res.error) {
        toast.error('删除自选股失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ watchlist: res.data });
        // 如果删除的是当前选中的股票，清空详情
        const { selectedStock } = get();
        if (selectedStock && selectedStock.market === market && selectedStock.code === code) {
          set({
            selectedStock: null,
            currentQuote: null,
            klineData: [],
            timelineData: [],
            moneyFlowData: [],
          });
        }
      }
    } catch (error) {
      console.error('删除自选股失败:', error);
      toast.error('删除自选股失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 更新自选股排序 */
  reorderWatchlist: async (items) => {
    try {
      const res = await client['stock:reorderWatchlist']({ items });
      if ('error' in res && res.error) {
        toast.error('排序失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ watchlist: res.data });
      }
    } catch (error) {
      console.error('排序失败:', error);
      toast.error('排序失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 批量刷新自选股行情 */
  refreshQuotes: async () => {
    const { watchlist } = get();
    if (!watchlist || watchlist.items.length === 0) return;

    set({ loadingQuotes: true });
    try {
      const stocks = watchlist.items.map((item) => ({
        market: item.market,
        code: item.code,
      }));
      const res = await client['stock:batchQuotes']({ stocks });
      if ('error' in res && res.error) {
        toast.error('刷新行情失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        const newQuotes = new Map<string, StockQuote>();
        for (const q of res.data) {
          newQuotes.set(quoteKey(q.market, q.code), q);
        }
        set({ quotes: newQuotes });
      }
    } catch (error) {
      console.error('刷新行情失败:', error);
      toast.error('刷新行情失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loadingQuotes: false });
    }
  },

  /** 选中股票，并行加载行情 + K线 */
  selectStock: async (market, code) => {
    set({
      selectedStock: { market, code },
      loadingDetail: true,
      // 清空分时和资金流向（懒加载）
      timelineData: [],
      moneyFlowData: [],
    });

    try {
      // 并行请求行情和 K线
      const { klinePeriod, klineAdjust } = get();
      const [quoteRes, klineRes] = await Promise.all([
        client['stock:getQuote']({ market, code }),
        client['stock:getKLine']({ market, code, period: klinePeriod, adjust: klineAdjust }),
      ]);

      // 处理行情结果
      if ('error' in quoteRes && quoteRes.error) {
        toast.error('获取行情失败', { description: quoteRes.error });
      } else if ('data' in quoteRes) {
        set({ currentQuote: quoteRes.data });
      }

      // 处理 K线结果
      if ('error' in klineRes && klineRes.error) {
        toast.error('获取K线失败', { description: klineRes.error });
      } else if ('data' in klineRes) {
        set({ klineData: klineRes.data });
      }
    } catch (error) {
      console.error('加载股票详情失败:', error);
      toast.error('加载股票详情失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loadingDetail: false });
    }
  },

  /** 加载 K线数据（可切换周期/复权） */
  loadKLine: async (period, adjust) => {
    const { selectedStock } = get();
    if (!selectedStock) return;

    // 更新参数
    const newPeriod = period ?? get().klinePeriod;
    const newAdjust = adjust ?? get().klineAdjust;
    set({ klinePeriod: newPeriod, klineAdjust: newAdjust, loadingDetail: true });

    try {
      const res = await client['stock:getKLine']({
        market: selectedStock.market,
        code: selectedStock.code,
        period: newPeriod,
        adjust: newAdjust,
      });
      if ('error' in res && res.error) {
        toast.error('获取K线失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ klineData: res.data });
      }
    } catch (error) {
      console.error('获取K线失败:', error);
      toast.error('获取K线失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loadingDetail: false });
    }
  },

  /** 懒加载分时数据 */
  loadTimeline: async () => {
    const { selectedStock } = get();
    if (!selectedStock) return;

    try {
      const res = await client['stock:getTimeline']({
        market: selectedStock.market,
        code: selectedStock.code,
      });
      if ('error' in res && res.error) {
        toast.error('获取分时数据失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ timelineData: res.data });
      }
    } catch (error) {
      console.error('获取分时数据失败:', error);
      toast.error('获取分时数据失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 懒加载资金流向数据 */
  loadMoneyFlow: async () => {
    const { selectedStock } = get();
    if (!selectedStock) return;

    try {
      const res = await client['stock:getMoneyFlow']({
        market: selectedStock.market,
        code: selectedStock.code,
      });
      if ('error' in res && res.error) {
        toast.error('获取资金流向失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ moneyFlowData: res.data });
      }
    } catch (error) {
      console.error('获取资金流向失败:', error);
      toast.error('获取资金流向失败', { description: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 搜索股票 */
  searchStocks: async (keyword) => {
    if (!keyword.trim()) {
      set({ searchResults: [], searchLoading: false });
      return;
    }

    set({ searchLoading: true });
    try {
      const res = await client['stock:search']({ keyword: keyword.trim() });
      if ('error' in res && res.error) {
        toast.error('搜索失败', { description: res.error });
        return;
      }
      if ('data' in res) {
        set({ searchResults: res.data });
      }
    } catch (error) {
      console.error('搜索失败:', error);
      toast.error('搜索失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ searchLoading: false });
    }
  },

  /** 清除搜索结果 */
  clearSearch: () => {
    set({ searchResults: [], searchLoading: false });
  },

  /** 加载限流器状态 */
  loadRateLimiterStatus: async () => {
    try {
      const res = await client['stock:getRateLimiterStatus'](undefined);
      if ('data' in res) {
        set({ rateLimiterStatus: res.data });
      }
    } catch (error) {
      console.error('获取限流器状态失败:', error);
    }
  },
}));
