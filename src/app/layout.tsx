import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CINEGEN AI — From Video to Cinematic Experience",
  description: "Open-source JavaScript AI video and audio enhancement platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-cine-dark text-slate-100 flex flex-col">
        {children}
      </body>
    </html>
  );
}
