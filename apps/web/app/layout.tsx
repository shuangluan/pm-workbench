import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PM Evidence Workbench",
  description: "Evidence-based request abstraction and impact checks, running locally for one user",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
