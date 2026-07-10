/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Necessário para o build Docker (output standalone mínimo).
  output: "standalone",
};

export default nextConfig;
