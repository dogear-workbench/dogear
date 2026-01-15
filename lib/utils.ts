import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * 合并 Tailwind CSS 类名的工具函数
 * 结合 clsx 和 tailwind-merge 的功能,智能处理类名冲突
 *
 * @param inputs - 类名输入,可以是字符串、对象、数组等
 * @returns 返回合并后的类名字符串
 *
 * @example
 * ```ts
 * cn('px-2 py-1', 'px-4') // => 'py-1 px-4' (px-2 被 px-4 覆盖)
 * cn('text-red', someCondition && 'text-blue') // => 'text-red' 或 'text-blue'
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
