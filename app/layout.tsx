import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZYRON",
  description: "Asistente personal privado de Aarón",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
