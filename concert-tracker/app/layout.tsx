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
      <body className="antialiased" id="app-body">
        <SessionProvider>
          <Navigation />
          <main id="main-content" className="lg:ml-16 pt-12 transition-all duration-300">
            {children}
          </main>
        </SessionProvider>
      </body>
    </html>
  );
}
