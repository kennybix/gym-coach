/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8010";

// NATIVE_BUILD=1 produces a static export (web/out) to bundle inside the Capacitor Android
// shell. There is no Next server in the APK, so rewrites don't apply — the app calls the
// backend directly via an absolute NEXT_PUBLIC_API_URL (the tailnet URL). The normal `next
// start` build keeps the single-origin proxy below.
const NATIVE = process.env.NATIVE_BUILD === "1";

const config = {
  images: { unoptimized: true }, // catalog images come from GitHub raw; SW caches them
};

if (NATIVE) {
  config.output = "export";
} else {
  config.rewrites = async () => [
    { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
    { source: "/coach/:path*", destination: `${BACKEND}/coach/:path*` },
    { source: "/knowledge/:path*", destination: `${BACKEND}/knowledge/:path*` },
  ];
}

export default config;
