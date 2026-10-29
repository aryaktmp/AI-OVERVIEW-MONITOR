import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "AI Overview Citation Monitor - LinovHR",
  description:
    "Google AI Overview citation monitoring system for LinovHR (linovhr.com)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
