# ZYRON Native — preparación exacta en Xcode

Este documento está pensado para reducir al mínimo el tiempo delante del Mac. El objetivo de la primera sesión no es diseñar interfaz: es instalar ZYRON en un iPhone físico y validar entrada/salida de audio con la pantalla bloqueada.

## 1. Crear el proyecto

- Xcode > Create New Project > iOS > App.
- Product Name: `ZYRON`.
- Interface: SwiftUI.
- Language: Swift.
- Deployment Target: iOS 16 o superior.
- Usar un Bundle Identifier propio del equipo de desarrollo.

## 2. Añadir los fuentes ya preparados

Añadir al target de la app todos los `.swift` de `ios/ZYRONNative/`.

No copiar claves permanentes de OpenAI ni claves del backend dentro del proyecto. El cliente nativo ya está diseñado para autenticarse contra el backend de ZYRON y guardar su sesión en Keychain.

## 3. Paquetes Swift

### Porcupine

Añadir el paquete oficial:

`https://github.com/Picovoice/porcupine.git`

El código usa `Porcupine` para detectar localmente la palabra `ZYRON`.

### WebRTC

Añadir un paquete iOS que exponga el módulo `WebRTC` y el XCFramework de libWebRTC. El transporte preparado en `WebRTCNativeTransport.swift` está aislado tras `#if canImport(WebRTC)`, por lo que Xcode mostrará claramente si falta esta dependencia.

No fijar una versión a ciegas antes de que Xcode resuelva las versiones disponibles. Elegir una versión estable compatible con la versión instalada de Xcode.

## 4. Permisos

En el target > Info añadir:

- `Privacy - Microphone Usage Description` (`NSMicrophoneUsageDescription`): `ZYRON necesita el micrófono para detectar su nombre y conversar contigo.`
- `Privacy - Speech Recognition Usage Description` (`NSSpeechRecognitionUsageDescription`): `ZYRON usa reconocimiento local para distinguir cuándo le estás llamando.`

La transcripción usada para validar una invocación configura `requiresOnDeviceRecognition = true`. Si el reconocimiento local no está disponible, ZYRON no abre Realtime por defecto.

## 5. Background audio

Target > Signing & Capabilities > `+ Capability` > Background Modes.

Marcar:

- `Audio, AirPlay, and Picture in Picture`.

La conversación activa usa `AVAudioSession` con categoría `playAndRecord` y modo `voiceChat`.

## 6. Recursos locales de wake word

Añadir al bundle de la app:

- el modelo personalizado `ZYRON.ppn`;
- el modelo español de Porcupine `.pv` si el modelo personalizado lo necesita.

Estos archivos están ignorados por Git y no deben subirse al repositorio.

La AccessKey de Picovoice debe introducirse solo en configuración local del Mac/iPhone. `NativeVoiceBootstrap` la recibe como parámetro y no contiene ningún secreto hardcodeado.

## 7. Primer arranque

Antes de activar la escucha permanente:

```swift
let permissions = await NativeVoiceBootstrap.requestPermissions()
guard permissions.readyForAlwaysOn else { return }
```

Crear los recursos y el runtime:

```swift
let resources = try NativeVoiceBootstrap.Resources.bundled(
    porcupineAccessKey: localPicovoiceAccessKey,
    spanishModelResource: "porcupine_params_es"
)

let runtime = try NativeVoiceBootstrap.makeRuntime(resources: resources)
try runtime.startAlwaysOn()
```

Si el nombre exacto del `.pv` español es distinto, usar ese nombre sin la extensión.

## 8. Autenticación nativa

Antes de la primera sesión Realtime, iniciar sesión una sola vez con el propietario usando `NativeAPIClient.shared.login(ownerKey:)`. El token resultante se guarda en Keychain con alcance de este dispositivo.

No guardar la owner key en código ni en `UserDefaults`.

## 9. Flujo que debe ocurrir

1. El iPhone mantiene un buffer circular local de hasta 4 segundos.
2. Porcupine detecta `ZYRON` localmente.
3. Se conservan 1,8 segundos posteriores a la detección.
4. Speech transcribe ese pequeño contexto únicamente en el dispositivo.
5. El clasificador decide si era invocación o una mención casual.
6. Solo si era una invocación válida se detiene el detector pasivo y se abre WebRTC Realtime.
7. Al terminar la conversación, se cierra Realtime y vuelve el detector local.

El audio ambiente del modo pasivo no debe enviarse al backend ni a OpenAI.

## 10. Prueba prioritaria

Primero usar una activación manual o directa si hace falta para aislar el audio nativo de la detección de wake word.

- Iniciar conversación.
- Bloquear el iPhone.
- Escuchar una respuesta completa.
- Sin desbloquear, hablar de nuevo.
- Confirmar que ZYRON recibe el turno y responde.
- Mantener la prueba al menos 2 minutos.

Solo después validar el wake word con pantalla bloqueada.

## 11. Prueba de invocación

Debe activar:

- `ZYRON, dime qué tengo mañana.`
- `Oye ZYRON, busca una farmacia cerca.`
- `ZYRON` seguido de una pausa clara.

No debe activar:

- `Ayer estaba hablando de ZYRON.`
- `La app ZYRON sigue en desarrollo.`
- `He dicho ZYRON varias veces.`

## 12. Horario silencioso

Forzar temporalmente `ZyronResponseMode.text` durante la prueba para verificar que:

- no se reproduce voz;
- la respuesta se entrega como texto/notificación;
- al volver a `audio`, ZYRON recupera la salida hablada.

## Criterio de éxito del día

La sesión termina con éxito si el iPhone físico consigue mantener micrófono + altavoz durante una conversación Realtime con la pantalla bloqueada. El wake word 24/7 es el segundo gate, no debe bloquear la validación del audio nativo.
