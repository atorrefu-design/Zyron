# ZYRON

Asistente personal independiente accesible desde móvil y web.

## Principio de arquitectura

ZYRON no depende de que un Mac permanezca encendido. El núcleo vive en la nube; el iPhone y la web son interfaces y puentes hacia capacidades del dispositivo.

- Backend/web: Next.js
- API y orquestación: rutas server-side
- Cliente nativo iPhone: `ios/`
- CI: GitHub Actions
- Objetivo de despliegue del núcleo: Vercel

Consulta `docs/architecture-v1.md` para la arquitectura y los siguientes hitos.

## Desarrollo

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Copia `.env.example` a `.env.local` y añade únicamente tus secretos locales. Nunca subas credenciales al repositorio.

## Estado

El repositorio ya contiene backend, health check, orquestación de voz y trabajo nativo iOS. La fase actual es convertirlo en un despliegue cloud-first y separar definitivamente el runtime de las limitaciones del Mac local.
