/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8010";

export default {
  images: { unoptimized: true }, // catalog images come from GitHub raw; SW caches them
  // Proxy the API to the FastAPI backend so the whole app is one origin. This means a
  // single proxy hop (Tailscale serve / nginx) only needs to point at the frontend, and
  // the browser never makes a cross-origin request (no CORS, no path-prefix surprises).
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/coach/:path*", destination: `${BACKEND}/coach/:path*` },
      { source: "/knowledge/:path*", destination: `${BACKEND}/knowledge/:path*` },
    ];
  },
};
