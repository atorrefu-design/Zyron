# ZYRON Native iPhone bootstrap

Objetivo de esta capa: convertir el iPhone en el oído y la boca nativos de ZYRON sin rehacer el núcleo web existente.

## Experiencia objetivo

- Escucha local permanente de la palabra de activación `ZYRON`, sin enviar audio ambiente a la nube.
- Distinguir una invocación directa de una simple mención del nombre antes de abrir una sesión remota.
- Tras una invocación válida, abrir conversación Realtime continua y permitir interrupciones naturales.
- De 07:00 a 01:00, responder por audio.
- De 01:00 a 07:00, no hablar: responder por texto/notificación silenciosa.
- Mantener entrada y salida de audio con el iPhone bloqueado cuando iOS lo permita mediante una sesión nativa `playAndRecord`.
- El API key permanente de OpenAI nunca debe almacenarse en la app.

## Lógica preparada antes de Xcode

El contrato de comportamiento ya está definido en `docs/voice-activation-v1.md` y `lib/voice-engagement.ts`.

El backend expone referencias para que la app nativa y la web compartan reglas:

- `POST /api/auth/native-login`: valida la clave privada del propietario una sola vez y devuelve una sesión Bearer de ZYRON.
- `GET /api/voice/policy`: devuelve horario de voz/texto y tiempos de engagement.
- `POST /api/voice/activation`: clasifica ejemplos de invocación durante desarrollo. La versión final de iPhone ejecuta esta decisión localmente para no depender de red.
- `POST /api/realtime/native-call`: recibe la oferta SDP del iPhone. La app indica `audio` o `text` según la política horaria y el servidor crea la sesión Realtime sin exponer la clave permanente de OpenAI.
- Los endpoints existentes `/api/chat` y `/api/places/search` son reutilizados por las herramientas de la conversación nativa.

`proxy.ts` acepta tanto la cookie de la web como la sesión Bearer de la app nativa. El token nativo se guarda únicamente en Keychain con `AfterFirstUnlockThisDeviceOnly`.

La conversación permanece activa sin repetir `ZYRON` y vuelve a escucha pasiva tras cierre explícito, cierre suave o 45 segundos de silencio completo.

## Swift ya preparado

- `AudioSessionManager.swift`: sesión `playAndRecord` + `voiceChat`, Bluetooth HFP, interrupciones, cambios de ruta y reinicio de servicios de audio.
- `VoiceCommunicationPolicy.swift`: regla local 07:00–01:00 audio / 01:00–07:00 texto.
- `VoiceEngagementClassifier.swift`: espejo local del clasificador de invocación.
- `VoiceSessionCoordinator.swift`: estados passive → candidate → active → ending → passive e inactividad de 45 s.
- `WakeWordDetector.swift`: adaptador local preparado para Porcupine y el modelo personalizado `ZYRON.ppn`.
- `KeychainStore.swift`: almacenamiento seguro de la sesión nativa.
- `NativeAPIClient.swift`: login, política, Realtime nativo y acceso autenticado al núcleo y Google Places.
- `RealtimeEvent.swift`: decodificación de eventos OpenAI Realtime y creación de eventos de cliente.
- `RealtimeToolRouter.swift`: ejecuta `consultar_nucleo_zyron` y `buscar_lugares_reales` usando el backend existente y puede recibir la ubicación actual del iPhone.
- `RealtimeConversationBridge.swift`: conecta eventos de la sesión Realtime con transcripciones, respuestas, herramientas y el coordinador de conversación.
- `QuietResponseNotifier.swift`: entrega respuestas nocturnas como notificación silenciosa visible también con el iPhone bloqueado.
- `VoiceOutputRouter.swift`: decide el canal de salida y evita audio durante 01:00–07:00.
- `NativeRealtimeTransport.swift`: contrato que deberá implementar el transporte WebRTC de iPhone.
- `ZyronVoiceRuntime.swift`: orquesta detector local, activación, sesión de audio, Realtime, interrupciones, cierre y vuelta al modo pasivo.

## Primera prueba en Xcode

1. Crear una app iOS SwiftUI llamada `ZYRON`.
2. Añadir `NSMicrophoneUsageDescription`.
3. Activar Background Modes > Audio, AirPlay, and Picture in Picture.
4. Importar los Swift de esta carpeta.
5. Hacer login una sola vez con la clave privada de ZYRON y comprobar que la sesión queda en Keychain.
6. Conceder notificaciones para que las respuestas de 01:00–07:00 puedan aparecer silenciosamente en la pantalla bloqueada.
7. Añadir el transporte WebRTC nativo que implemente `NativeRealtimeTransport`.
8. Instalar el detector local y el transporte en `ZyronVoiceRuntime`.
9. Instalar en el iPhone físico.
10. Prueba decisiva: iniciar conversación, bloquear manualmente la pantalla y comprobar que ZYRON sigue escuchando y respondiendo.
11. Simular modo silencioso y confirmar que la respuesta llega por texto/notificación y no genera audio.

OpenAI admite Realtime sobre WebRTC, WebSocket o SIP. Para el cliente iPhone mantenemos WebRTC como transporte principal y dejamos el backend como guardián de la clave permanente de OpenAI.

## Wake word

Para el detector local, la primera opción a validar es Porcupine para iOS porque admite wake words personalizados y procesamiento local. El modelo `ZYRON.ppn` y cualquier AccessKey se incorporarán después de validar la prueba básica de audio bloqueado. Nunca se debe subir una AccessKey al repositorio.

El siguiente punto a validar es la ventana de contexto local alrededor de `ZYRON`. La activación no debe enviar audio ambiente a la nube y debe poder descartar menciones casuales antes de abrir Realtime.

## Segunda prueba

Una vez validado el audio bloqueado:

1. Añadir detector local de `ZYRON`.
2. Mantener una ventana local de contexto de hasta 4 segundos.
3. Aplicar `VoiceEngagementClassifier` antes de abrir Realtime.
4. Validar frases directas y menciones casuales.
5. Añadir recuperación automática tras llamadas, interrupciones de Siri y cambios de Bluetooth.
6. Autorizar Contactos desde la tarjeta nativa y validar llamada, WhatsApp y SMS con el Gate 7 de \`ACCEPTANCE.md\`.
