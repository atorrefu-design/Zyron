import { listGoals, type ZyronGoal } from "../db";

const goalKeywords: Record<string, string[]> = {
  zyron: ["zyron", "asistente", "memoria", "agente", "vercel", "github", "openai", "mem0", "neon", "app", "pwa", "backend", "frontend", "deploy", "despliegue"],
  vivienda: ["vivienda", "casa", "terreno", "parcela", "garaje", "porche", "cocina", "plano", "render", "hipoteca", "prefabricada", "obra"],
  maninter: ["maninter", "mantenimiento", "operario", "operarios", "ot", "pci", "baja tension", "bt", "extintor", "bie", "instalacion", "centralizado", "montante", "parking"],
  baloncesto: ["baloncesto", "basket", "brafa", "entreno", "entrenamiento", "partido", "jugador", "jugadora", "equipo", "defensa", "presion", "tactica", "estadistica"],
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scoreGoal(title: string, goal: ZyronGoal) {
  const clean = normalize(title);
  const directNames = [goal.name, goal.slug].map(normalize);
  let score = directNames.some((name) => clean.includes(name)) ? 5 : 0;

  for (const keyword of goalKeywords[goal.slug] ?? []) {
    if (clean.includes(normalize(keyword))) score += keyword.includes(" ") ? 3 : 1;
  }

  return score;
}

export async function inferGoalForTask(title: string): Promise<ZyronGoal | null> {
  const goals = (await listGoals()).filter((goal) => goal.active);
  const ranked = goals
    .map((goal) => ({ goal, score: scoreGoal(title, goal) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].goal;
}
