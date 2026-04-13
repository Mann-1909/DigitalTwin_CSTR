import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  
  // Allow your specific local IP to access the dev server resources
  // Note: Depending on your exact Next.js 15 version, TypeScript might expect this 
  // inside an `experimental: {}` block. If it throws a red underline, move it inside there!
  allowedDevOrigins: ['169.254.206.180','192.168.56.1', 'localhost'],
};

export default nextConfig;