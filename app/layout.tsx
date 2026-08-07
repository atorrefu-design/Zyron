import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZYRON",
  description: "Asistente personal privado de Aarón",
  themeColor: "#0b1430",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZYRON",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
