import bundleAnalyzer from '@next/bundle-analyzer';

// 体积分析包装器：仅在 ANALYZE=true 时启用，生产构建不受影响
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // 5.7.1：React Compiler 切 'all' 模式，全量编译所有组件，自动 memoize
  // 减少 manual useMemo / useCallback 漏写导致的重渲染。
  // 业务代码已稳定，灰度结束切全量；如有性能回归可回退 'annotation'。
  reactCompiler: {
    compilationMode: 'all',
  },
  // 5.7.1：optimizePackageImports 减少首屏打包体积
  // - lucide-react：仅打包用到的图标，避免全量 1000+ 图标进入 bundle
  // - reactflow：按需导入 ReactFlow / MiniMap / Background 等子模块
  experimental: {
    optimizePackageImports: ['lucide-react', 'reactflow'],
  },
  // 5.7.1 注记：dagre 已在 git-layout.ts / auto-layout.ts 中改为 dynamic import，
  // 首次使用时异步加载独立 chunk，不进入主 bundle。
};

export default withBundleAnalyzer(nextConfig);
