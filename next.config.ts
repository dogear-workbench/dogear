import type { NextConfig } from "next";

// Next.js 配置文件
// 用于配置 Next.js 应用程序的构建和导出设置
const nextConfig: NextConfig = {
  // 导出为静态 HTML，用于 Electron 打包
  // 这样 Next.js 会生成静态文件，而不是运行一个开发服务器
  output: 'export',

  // 图片优化配置
  images: {
    // 禁用图片优化，因为静态导出不支持 Next.js 的图片优化服务
    // Electron 应用将使用原图片
    unoptimized: true,
  },
};

export default nextConfig;
