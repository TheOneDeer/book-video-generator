import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
    ],
  },
  // 增加API超时时间，支持长时间的SSE流式请求
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // API路由超时配置（30分钟）
  // 注意：这个配置在Next.js 15+中通过环境变量设置更可靠
};

export default nextConfig;
