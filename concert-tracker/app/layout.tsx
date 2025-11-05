import type { Metadata } from "next";
import "./globals.css";
import Navigation from "./components/Navigation";
import SessionProvider from "./components/SessionProvider";

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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <SessionProvider>
          <Navigation />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
