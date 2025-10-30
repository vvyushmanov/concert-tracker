import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concert Tracker",
  description: "Track metal concerts from your favorite artists",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
