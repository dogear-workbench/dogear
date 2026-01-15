import type { NextConfig } from "next";

// Next.js 配置文件
// 用于配置 Next.js 应用程序的构建和导出设置
const nextConfig: NextConfig = {
  // 图片优化配置
  images: {
    // 禁用图片优化，因为静态导出不支持 Next.js 的图片优化服务
    // Electron 应用将使用原图片
    unoptimized: true,
  },
};

export default nextConfig;
