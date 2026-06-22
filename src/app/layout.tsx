import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "UB Twin AI — Digital Twin of Ulaanbaatar",
  description:
    "Simulate city decisions before making them. An AI digital twin of Ulaanbaatar that predicts impact on traffic, pollution, emergency response, and energy.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
