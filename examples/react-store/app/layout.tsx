import type { ReactNode } from "react";
import { Bricolage_Grotesque } from "next/font/google";
import { PROFILE } from "@/lib/profile";
import "./store.css";

const font = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });

export const metadata = { title: `${PROFILE.name} · @${PROFILE.handle}`, description: PROFILE.bio };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body>
        <div className="dots" aria-hidden />
        <main>{children}</main>
      </body>
    </html>
  );
}
