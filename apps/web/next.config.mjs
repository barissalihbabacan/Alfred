/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
    serverComponentsExternalPackages: [
      'sharp',
      'ssh2'
    ],
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };

    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'ssh2': 'commonjs ssh2',
      });
    }
    return config;
  },
};

export default nextConfig;
