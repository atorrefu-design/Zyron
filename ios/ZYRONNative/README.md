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

## Primera prueba en Xcode

1. Crear una app iOS SwiftUI llamada `ZYRON`.
2. Añadir `NSMicrophoneUsageDescription`.
3. Activar Background Modes > Audio, AirPlay, and Picture in Picture.
4. Importar `AudioSessionManager.swift` y `VoiceCommunicationPolicy.swift`.
5. Activar `AudioSessionManager.shared.activateForConversation()` antes de iniciar la conexión Realtime.
6. Conectar el transporte Realtime al backend actual de ZYRON, manteniendo la clave de OpenAI exclusivamente en servidor.
7. Instalar en el iPhone físico.
8. Prueba decisiva: iniciar conversación, bloquear manualmente la pantalla y comprobar que ZYRON sigue escuchando y respondiendo.

## Siguiente capa

Una vez validado el audio bloqueado, añadir detector local de wake word, clasificador de invocación y recuperación automática tras interrupciones del sistema, llamadas o cambios de dispositivo Bluetooth.
