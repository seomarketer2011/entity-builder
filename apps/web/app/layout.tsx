import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Entity Builder — SEO Opportunity Engine",
  description: "Entity graphs, page manifests, and explainable SEO opportunities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="brand">
            Entity Builder
          </a>
          <nav>
            <a href="/">Campaigns</a>
            <a href="/logout">Sign out</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
