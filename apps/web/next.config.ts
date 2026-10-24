import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Credential evidence uploads go through server actions (files up to 10 MB).
  experimental: { serverActions: { bodySizeLimit: '11mb' } },
};

export default config;
