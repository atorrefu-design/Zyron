# ZYRON para iPhone

Esta carpeta ya define una app SwiftUI instalable, no solo una colección de fuentes. El proyecto se genera de forma reproducible con XcodeGen y fija las dependencias de Porcupine y WebRTC.

## Abrir en el Mac

```bash
cd ios
chmod +x bootstrap-xcode.sh
./bootstrap-xcode.sh
```

El script instala XcodeGen mediante Homebrew si hace falta, genera `ZYRON.xcodeproj`, resuelve los paquetes Swift y abre Xcode.

En Xcode queda una única configuración manual obligatoria:

1. seleccionar el target `ZYRON`;
2. abrir `Signing & Capabilities`;
3. elegir el Apple Development Team de Aarón;
4. seleccionar el iPhone físico y pulsar Run.

No hay que copiar ninguna clave de OpenAI a la app. En el primer arranque, ZYRON pide la clave privada del propietario para obtener una sesión nativa. La AccessKey de Picovoice se introduce en la propia app y queda en Keychain.

## Orden de validación

1. Iniciar sesión.
2. Pulsar `Hablar con ZYRON`.
3. Bloquear el iPhone y mantener una conversación durante dos minutos.
4. Solo cuando eso funcione, introducir la AccessKey de Picovoice y activar la escucha local por `ZYRON`.

Para generar el proyecto y comprobar una compilación de simulador sin abrir Xcode:

```bash
./bootstrap-xcode.sh --verify
```

La prueba final de audio con pantalla bloqueada requiere un iPhone físico; el simulador no valida ese comportamiento.
