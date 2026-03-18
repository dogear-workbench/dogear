import { create } from 'zustand';

export interface ConfirmButton {
  label: string;
  value: string;
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
}

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  buttons: ConfirmButton[];
  resolve: ((value: string | null) => void) | null;

  /**
   * 通用确认弹窗，返回用户点击的按钮 value，取消返回 null
   */
  confirm: (options: {
    title: string;
    description: string;
    buttons?: ConfirmButton[];
  }) => Promise<string | null>;

  close: (value: string | null) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  title: '',
  description: '',
  buttons: [],
  resolve: null,

  confirm: ({ title, description, buttons }) => {
    return new Promise<string | null>((resolve) => {
      set({
        open: true,
        title,
        description,
        buttons: buttons ?? [
          { label: '取消', value: 'cancel', variant: 'outline' },
          { label: '确定', value: 'confirm', variant: 'destructive' },
        ],
        resolve,
      });
    });
  },

  close: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

/**
 * 简单确认（替代 window.confirm），返回 boolean
 */
export async function showConfirm(title: string, description: string): Promise<boolean> {
  const result = await useConfirmStore.getState().confirm({ title, description });
  return result === 'confirm';
}
