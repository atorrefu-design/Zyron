# Canal privado de Telegram · ZYRON v0.18

## Objetivo

Telegram es el primer canal externo de ZYRON. Utiliza el mismo núcleo agente, la misma memoria PostgreSQL/Neon y las mismas políticas que la web, sin convertir Telegram en una nueva fuente de verdad.

## Arquitectura

1. Telegram entrega cada actualización por HTTPS a `/api/channels/telegram/webhook`.
2. El proxy deja pública únicamente esa ruta.
3. El webhook valida `X-Telegram-Bot-Api-Secret-Token` antes de leer el cuerpo.
4. La base de datos comprueba que el usuario y el chat privado están vinculados.
5. Un registro idempotente evita volver a ejecutar una actualización repetida.
6. ZYRON recupera un historial temporal del canal y, si está vigente, únicamente la última ubicación autorizada; ejecuta el núcleo agente y responde al mismo chat.
7. Las notas de voz autorizadas se descargan temporalmente desde Telegram, se transcriben y se descartan sin persistir el audio.

La configuración y el estado se gestionan desde `/channels`. Su API, `/api/channels/telegram`, continúa protegida por la sesión del propietario.

## Variables de entorno

```bash
ZYRON_PUBLIC_URL=https://zyron-five.vercel.app
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
```

- `TELEGRAM_BOT_TOKEN` se obtiene exclusivamente desde `@BotFather`.
- `TELEGRAM_WEBHOOK_SECRET` debe contener entre 16 y 256 caracteres seguros: letras, números, `_` y `-`.
- Ninguna credencial se guarda en el repositorio, en la memoria de conversación ni en el navegador.

## Activación

1. Crear un bot con `@BotFather` y guardar el token en las variables seguras de Vercel.
2. Generar un secreto de webhook y configurar `ZYRON_PUBLIC_URL`.
3. Abrir ZYRON → Canales → Telegram.
4. Pulsar **Activar y generar código**.
5. Enviar `/pair ABCD-EFGH` al bot antes de que el código caduque.
6. Actualizar el estado de la pantalla. Solo el chat vinculado podrá utilizar el agente.

El código de vinculación dura 15 minutos, se guarda únicamente como hash y solo puede utilizarse una vez.

## Comandos

- `/start` o `/help`: ayuda del canal.
- `/status`: confirma que el chat está conectado.
- `/capacidades`: muestra qué ejecuta Telegram directamente, qué resuelve el núcleo común y qué requiere el companion del iPhone.
- `/reset`: elimina el historial temporal de Telegram. No modifica la memoria permanente.
- `/location`: comprueba si ZYRON dispone de una ubicación vigente.
- `/forget_location`: elimina inmediatamente la ubicación temporal guardada por ZYRON.
- `/memoria tema`: busca bloques relevantes directamente en PostgreSQL/Neon, sin modelo de IA.
- `/memoria_toda 1`: recorre todos los bloques activos de memoria mediante páginas.
- `/memoria_estado`: muestra documentos, bloques y revisiones disponibles.
- `/guardar_memoria hecho`: escribe directamente en la memoria canónica, sin modelo de IA.

También se enrutan sin IA las consultas de texto explícitas «Qué recuerdas de…», «Busca en tu memoria…» y `Memoria: tema`. La respuesta reproduce los bloques recuperados; no los resume ni los envía a ningún proveedor de modelos. Las consultas generales continúan utilizando el núcleo agente cuando no coinciden con esta ruta determinista.

Las órdenes «Recuerda que…» y «Guarda en tu memoria que…» se escriben directamente. Cuando ZYRON haya propuesto guardar el mensaje anterior, «Guárdalo en la memoria» y un posterior «Inténtalo de nuevo» recuperan ese hecho pendiente del historial temporal y lo guardan solo después de la confirmación visible. Web, app y Telegram utilizan las mismas tablas `zyron_memory_*`; no existe una memoria paralela del canal.

## Ubicación en tiempo real

- Telegram exige que Aarón inicie manualmente **Compartir ubicación en tiempo real** desde el chat privado del bot.
- El webhook acepta tanto el mensaje inicial como sus actualizaciones `edited_message` y reemplaza la posición anterior.
- Solo se conserva la última posición, nunca un historial de movimientos.
- Las actualizaciones no invocan IA ni generan respuestas repetidas.
- La posición deja de utilizarse cuando caduca el periodo elegido en Telegram. Una ubicación estática caduca a los 30 minutos.
- `/forget_location` borra la posición antes de su caducidad. Detenerla en Telegram impide nuevas actualizaciones; ZYRON también respetará la caducidad recibida.

## Notas de voz

- Solo se descargan después de comprobar que el chat pertenece a Aarón.
- El límite es de 3 minutos y 8 MB por nota.
- El archivo de audio no se guarda en Neon, Vercel ni en la memoria de ZYRON.
- La transcripción se incorpora al historial temporal y utiliza el mismo núcleo agente que el texto.
- El modelo predeterminado es `gpt-4o-mini-transcribe`; puede cambiarse con `ZYRON_TRANSCRIPTION_MODEL`.

## Seguridad y privacidad

- Se aceptan únicamente chats privados.
- Los mensajes salientes se marcan como contenido protegido.
- Un usuario no vinculado nunca llega al modelo ni a las herramientas.
- Los errores no registran el token del bot ni el secreto del webhook.
- El historial temporal se elimina automáticamente tras 30 días.
- La ubicación se guarda separada del historial y se elimina al caducar; las coordenadas no se incluyen en auditorías ni logs.
- Las respuestas pendientes se conservan para reintentar el envío sin volver a ejecutar las herramientas.
- Telegram no crea capacidades paralelas: utiliza el catálogo del núcleo común. El borrado de una tarea o evento requiere confirmación posterior e inequívoca; la mensajería a terceros y la ejecución arbitraria continúan bloqueadas.

## Alcance de esta versión

ZYRON v0.18 recibe texto y notas de voz del propietario y dispone desde Telegram de memoria canónica, tareas, calendario, Gmail, Drive, mapas e información vigente. Las acciones que solo puede iniciar iOS —abrir aplicaciones, llamadas, SMS/WhatsApp, grabación y notificaciones nativas— requieren el companion y nunca se anuncian falsamente como ejecutadas desde Telegram.

Referencias oficiales: [Telegram Bot API](https://core.telegram.org/bots/api) y [OpenAI Speech to Text](https://developers.openai.com/api/docs/guides/speech-to-text).
