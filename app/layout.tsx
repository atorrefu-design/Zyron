import type { Metadata } from "next";
import "./globals.css";
import VoiceBridge from "./voice-bridge";

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
      <body>
        <VoiceBridge />
        {children}
        <div style={{ textAlign: "center", fontSize: "0.72rem", opacity: 0.5, padding: "0 16px 16px" }}>
          La voz de ZYRON está generada por IA.
        </div>
      </body>
    </html>
  );
}
