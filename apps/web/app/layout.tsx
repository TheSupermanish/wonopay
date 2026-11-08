import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-source" });

const SITE_TITLE = "Wono — scattered balances, one checkout";
const SITE_DESCRIPTION = "Combine supported token balances across Solana and EVM chains to pay one invoice. Merchants receive native USDC in their own Solana wallet.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wonopay.vercel.app"),
  title: { default: SITE_TITLE, template: "%s · Wono" },
  description: SITE_DESCRIPTION,
  openGraph: { title: SITE_TITLE, description: SITE_DESCRIPTION, type: "website" },
  twitter: { card: "summary", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

// Applies the stored or system theme before paint so dark mode never flashes.
// Embedded checkout is a transparent overlay on the merchant's page: light unless the page asks for ?theme=dark.
const themeScript = `try{var d=document.documentElement;if(location.pathname.indexOf("/embed/")===0){d.classList.add("embed");if(new URLSearchParams(location.search).get("theme")==="dark")d.classList.add("dark")}else{var t=localStorage.getItem("boardui:theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-background-full font-sans text-text-primary antialiased">{children}</body>
    </html>
  );
}
