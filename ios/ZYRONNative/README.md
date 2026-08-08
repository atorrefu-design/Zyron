# ZYRON Native iPhone bootstrap

Objetivo de esta capa: convertir el iPhone en el oído y la boca nativos de ZYRON sin rehacer el núcleo web existente.

## Experiencia objetivo

- Escucha local permanente de la palabra de activación `ZYRON`, sin enviar audio ambiente a la nube.
- Distinguir una invocación directa de una simple mención del nombre antes de abrir una sesión remota.
- Tras una invocación válida, abrir conversación Realtime continua y permitir interrupciones naturales.
- De 07:00 a 01:00, responder por audio.
- De 01:00 a 07:00, no hablar: responder por texto/notificación.
- Mantener entrada y salida de audio con el iPhone bloqueado cuando iOS lo permita mediante una sesión nativa `playAndRecord`.
- El API key permanente de OpenAI nunca debe almacenarse en la app.

## Lógica preparada antes de Xcode

El contrato de comportamiento ya está definido en `docs/voice-activation-v1.md` y `lib/voice-engagement.ts`.

El backend expone dos referencias para que la app nativa y la web compartan reglas:

- `GET /api/voice/policy`: devuelve horario de voz/texto y tiempos de engagement.
- `POST /api/voice/activation`: clasifica ejemplos de invocación durante desarrollo. La versión final de iPhone debe ejecutar esta decisión localmente para no depender de red.

La conversación permanece activa sin repetir `ZYRON` y vuelve a escucha pasiva tras cierre explícito, cierre suave o 45 segundos de silencio completo.

## Primera prueba en Xcode

1. Crear una app iOS SwiftUI llamada `ZYRON`.
2. Añadir `NSMicrophoneUsageDescription`.
3. Activar Background Modes > Audio, AirPlay, and Picture in Picture.
4. Importar `AudioSessionManager.swift` y `VoiceCommunicationPolicy.swift`.
5. Activar `AudioSessionManager.shared.activateForConversation()` antes de iniciar la conexión Realtime.
6. Conectar el transporte Realtime al backend actual de ZYRON, manteniendo la clave de OpenAI exclusivamente en servidor.
7. Instalar en el iPhone físico.
8. Prueba decisiva: iniciar conversación, bloquear manualmente la pantalla y comprobar que ZYRON sigue escuchando y respondiendo.

## Segunda prueba

Una vez validado el audio bloqueado:

1. Añadir detector local de `ZYRON`.
2. Mantener una ventana local de contexto de hasta 4 segundos.
3. Aplicar el clasificador de invocación antes de abrir Realtime.
4. Validar frases directas y menciones casuales.
5. Añadir recuperación automática tras llamadas, interrupciones de Siri y cambios de Bluetooth.
