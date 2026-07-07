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
  // React Compiler（annotation 模式灰度）：仅编译带 "use memo" 指令的文件
  // 业务文件暂未加该指令，编译器实际为 no-op，后续逐文件启用后再切 'all' 模式
  reactCompiler: {
    compilationMode: 'annotation',
  },
};

export default withBundleAnalyzer(nextConfig);
