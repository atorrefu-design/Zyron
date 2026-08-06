import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZYRON",
    short_name: "ZYRON",
    description: "Asistente personal privado de Aarón",
    start_url: "/",
    display: "standalone",
    background_color: "#050915",
    theme_color: "#0b1430",
    orientation: "portrait",
    lang: "es-ES",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}
