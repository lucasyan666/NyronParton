/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // Plain static files in out/: nothing here needs a server, so the site is
  // hosted as files on Cloudflare Pages (npm run deploy).
  output: 'export',
};
export default nextConfig;
