# ZYRON

Asistente personal independiente accesible desde móvil y web.

## Principio de arquitectura

ZYRON no depende de que un Mac permanezca encendido. El núcleo vive en la nube; el iPhone y la web son interfaces y puentes hacia capacidades del dispositivo.

- Backend/web: Next.js
- API y orquestación: rutas server-side
- Núcleo agente: skills contextuales, herramientas verificables y política determinista
- Motores de IA: OpenAI directo y enrutador opcional a Claude/Gemini mediante Vercel AI Gateway
- Memoria privada y portátil: PostgreSQL/Neon con importación Markdown y exportación JSON
- Canales: web/PWA, companion iOS y gateway privado para Telegram con texto, notas de voz, ubicación y memoria canónica
- Cliente nativo iPhone: `ios/`
- CI: GitHub Actions
- Objetivo de despliegue del núcleo: Vercel

Consulta `docs/architecture-v1.md`, `docs/AGENT_CORE_V2.md`, `docs/MEMORY_API.md` y `docs/TELEGRAM_CHANNEL.md` para la arquitectura, el núcleo agente, la memoria y el primer canal externo.

## Desarrollo

```bash
npm install
npm run typecheck
npm run test:channels
npm run build
npm run dev
```

Copia `.env.example` a `.env.local` y añade únicamente tus secretos locales. Nunca subas credenciales al repositorio.

El chat usa OpenAI de forma predeterminada. Con `AI_GATEWAY_API_KEY` configurada también acepta instrucciones explícitas como `Usa Claude: ...` y `Usa Gemini: ...`; PostgreSQL sigue siendo la única fuente de verdad de la memoria y las respuestas de un modelo no se guardan en ella automáticamente.

## Estado

El repositorio ya contiene backend, health check, núcleo agente con herramientas, orquestación de voz, memoria persistente propia, gateway seguro de Telegram y companion nativo iOS. El agente puede consultar tareas y calendario, crear y completar tareas, crear o eliminar eventos de Google Calendar tras una confirmación explícita, buscar lugares, calcular rutas en coche con tráfico, consultar Gmail y Google Drive en modo privado y crear carpetas o documentos nuevos en Drive tras confirmación. Telegram puede leer, recorrer y escribir memorias explícitamente confirmadas en las mismas tablas canónicas que la web y la app, con rutas directas que no requieren un modelo de IA. El companion puede solicitar acceso completo o limitado a Contactos para resolver destinatarios y preparar llamadas, SMS o chats de WhatsApp; nunca envía mensajes automáticamente y bloquea contactos o teléfonos ambiguos. No puede editar, mover, compartir ni borrar archivos de Drive. La memoria no depende de ChatGPT ni de un proveedor de modelos: vive en la misma base PostgreSQL privada que utiliza el núcleo.
