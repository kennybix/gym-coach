/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8010";

// Single origin: the frontend proxies the API, so the browser, the installed PWA and the Android
// app (which loads this same site via Capacitor `server.url`) all talk to one host — no CORS, one
// TLS cert. (There used to be a NATIVE_BUILD static export for the APK; it froze the UI at build
// time and was removed in favour of loading the live site.)
const config = {
  images: { unoptimized: true }, // catalog images come from GitHub raw; SW caches them
  rewrites: async () => [
    { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
    { source: "/coach/:path*", destination: `${BACKEND}/coach/:path*` },
    { source: "/knowledge/:path*", destination: `${BACKEND}/knowledge/:path*` },
  ],
};

export default config;
