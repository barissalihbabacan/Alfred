/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
    serverComponentsExternalPackages: [
      'kokoro-js',
      'onnxruntime-node',
      '@huggingface/transformers',
      'sharp'
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
        'onnxruntime-node': 'commonjs onnxruntime-node',
        'kokoro-js': 'commonjs kokoro-js',
      });
    }
    return config;
  },
};

export default nextConfig;
