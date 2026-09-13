export type PersonalPlaceKey = "home" | "work";

// Direcciones reales de Aarón. Editable sin tocar código mediante las
// variables de entorno ZYRON_HOME_ADDRESS / ZYRON_WORK_ADDRESS en Vercel
// (Project Settings -> Environment Variables) si alguna vez cambian.
const DEFAULT_PERSONAL_PLACES: Record<PersonalPlaceKey, string> = {
  home: "Calle Juan Ramón Jiménez, 12, Barcelona",
  work: "Jacint Verdaguer, 154, Sabadell",
};

function isPersonalPlaceKey(value: string): value is PersonalPlaceKey {
  return value === "home" || value === "work";
}

/**
 * Resuelve un alias personal ("home" | "work") a la dirección real conocida
 * por ZYRON. Devuelve null si la clave no es reconocida.
 */
export function resolvePersonalPlaceAddress(key: string): string | null {
  if (!isPersonalPlaceKey(key)) return null;
  const envKey = key === "home" ? "ZYRON_HOME_ADDRESS" : "ZYRON_WORK_ADDRESS";
  const fromEnv = process.env[envKey]?.trim();
  return fromEnv || DEFAULT_PERSONAL_PLACES[key];
}
