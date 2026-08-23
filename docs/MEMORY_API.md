# Memoria privada y portátil de ZYRON

## Objetivo

La memoria vive en el mismo PostgreSQL/Neon privado que las tareas y objetivos de ZYRON. No depende de ChatGPT, Mem0 ni de un proveedor concreto de modelos. El documento maestro se importa como Markdown, se divide en bloques recuperables y conserva revisiones para poder exportarlo o trasladarlo.

## Seguridad

- La base de datos nunca se expone directamente.
- Todas las rutas de datos pasan por la autenticación de propietario de ZYRON.
- La web utiliza su cookie privada.
- Un cliente nativo u otra aplicación autorizada obtiene una sesión temporal mediante `POST /api/auth/native-login` y envía después `Authorization: Bearer <token>`.
- La clave del propietario, los tokens y `DATABASE_URL` nunca se incluyen en la memoria ni en Git.

## Uso desde la web

1. Inicia sesión en ZYRON.
2. Abre `/memory`.
3. Selecciona `ZYRON_MEMORY_MASTER.md` y pulsa **Importar memoria**.
4. Prueba una pregunta en **Probar recuperación**.
5. Vuelve al chat y pregunta a ZYRON por una rutina, persona, proyecto o preferencia.

Una importación repetida actualiza el documento sin duplicar los bloques. Cada contenido distinto queda conservado como una revisión.

## API

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/memory` | Estado y documentos disponibles. |
| `POST` | `/api/memory` | Guardar una memoria explícita. |
| `GET` | `/api/memory/search?q=...` | Recuperar bloques relevantes. |
| `POST` | `/api/memory/context` | Obtener contexto listo para inyectar en otra IA. |
| `POST` | `/api/memory/import` | Importar o reemplazar un documento Markdown. |
| `GET` | `/api/memory/export` | Descargar una copia JSON portátil. |
| `GET` | `/api/memory/openapi` | Especificación OpenAPI para integraciones. |

## Escritura desde el chat

ZYRON guarda directamente una memoria cuando Aarón utiliza una orden explícita como:

- `Recuerda que ...`
- `Guarda en tu memoria que ...`
- `Memoriza que ...`
- `A partir de ahora, ...`

No se guardan automáticamente conversaciones completas. Esta decisión evita convertir saludos, errores, información transitoria o datos privados innecesarios en memoria permanente.

## Portabilidad

`GET /api/memory/export` devuelve documentos, bloques, metadatos y fechas en JSON. El Markdown original también queda incluido en el documento exportado. Esto permite migrar la memoria a otra base, una aplicación distinta o un modelo diferente sin depender del historial de ChatGPT.
