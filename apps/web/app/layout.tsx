import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PM Evidence Workbench",
  description: "证据驱动的需求抽象与影响检查（本地单人版）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
