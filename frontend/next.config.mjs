import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Necessário para o build Docker (output standalone mínimo).
  output: "standalone",
  // Este é um workspace npm: as dependências ficam içadas em `../node_modules`.
  // Sem apontar a raiz de rastreio para o monorepo, o standalone é montado a
  // partir de `frontend/` e sai sem os pacotes içados — o container quebra no
  // boot com "Cannot find module 'next'". Com a raiz correta, o servidor é
  // gerado em `.next/standalone/frontend/server.js` (é esse caminho que o
  // Dockerfile usa no CMD).
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
};

export default nextConfig;
