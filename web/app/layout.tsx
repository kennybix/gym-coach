import type { Metadata, Viewport } from "next";
import "./globals.css";
import SwRegister from "@/components/SwRegister";
import DevAutoConfig from "@/components/DevAutoConfig";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Gym Coach",
  description: "Personal training log + AI coach",
  manifest: "/manifest.json",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GymCoach" },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh flex flex-col">
        <SwRegister />
        <DevAutoConfig />
        <main className="flex-1 w-full max-w-md mx-auto px-5 pt-7 pb-28">{children}</main>
        <NavBar />
      </body>
    </html>
  );
}
