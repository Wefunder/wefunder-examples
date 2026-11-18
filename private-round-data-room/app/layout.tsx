import type { ReactNode } from "react";
import "./globals.css";

// A private round's data room should not be indexed.
export const metadata = { title: "Private round data room — Wefunder API example", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
