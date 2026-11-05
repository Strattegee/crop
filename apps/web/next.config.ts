import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Credential evidence uploads go through server actions (files up to 10 MB); the public application form sends
  // several at once (up to 30 MB in all).
  experimental: { serverActions: { bodySizeLimit: '31mb' } },
};

export default config;
