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

## Modo coche en Atajos (companion 0.8.0)

La acción se llama **Modo coche ZYRON**. Está definida en
`ZYRONApp/ZyronShortcuts.swift` y se incluye al generar `ios/project.yml`.
El arranque y el retorno a primer plano actualizan el catálogo de App Shortcuts.
La pantalla del companion permite solicitar esa actualización manualmente.

Para actualizar una instalación hecha con Xcode:
1. Guarde los cambios locales que haya hecho con Claude antes de actualizar el repositorio.
2. Incorpore esta versión y genere de nuevo el proyecto con `ios/bootstrap-xcode.sh`.
3. Compile el target **ZYRON** de `ios/ZYRON.xcodeproj` para el iPhone.
   No utilice `ios/CloudSmoke`: es una app de pruebas sin voz ni App Intents.
4. Abra el companion y compruebe que indica **0.8.0**.
5. Pulse **Actualizar acciones de Atajos**.
6. En Atajos, cree un atajo, añada la acción **Modo coche ZYRON** y ejecútelo
   con el teléfono desbloqueado para comprobar voz, permisos y sesión.
7. Asigne ese atajo a una automatización personal Bluetooth, seleccionando
   únicamente el dispositivo del coche y la ejecución inmediata si iOS la ofrece.

La automatización y la selección del Bluetooth se realizan en el iPhone.
Un despliegue de Vercel no instala App Intents en iOS. La actualización del catálogo
no garantiza por sí sola su indexación; hay que comprobar la app instalada.
La prueba de compilación tampoco verifica el audio del coche ni el comportamiento
con la pantalla bloqueada.

Referencia: [AppShortcutsProvider de Apple](https://developer.apple.com/documentation/appintents/appshortcutsprovider).

## Memoria común y voz (0.8.0, compilación 3)

La app envía las transcripciones finales al historial privado `/history`, con una cola local protegida que se vacía al conectar, al volver a primer plano o al pulsar Sincronizar conversaciones. No borre la app mientras indique mensajes pendientes. El estado se muestra en Memoria compartida.

El inicio de voz carga memoria y conversaciones recientes del mismo núcleo que web y Telegram. La consulta nativa utiliza `/api/agent` y conserva los últimos turnos. Se ha activado detección semántica de fin de turno, con interrupciones y voz cedar. El acento y los tiempos requieren escuchar la app en un iPhone real.

Antes de compilar, guarde los cambios propios del Mac con un commit o una copia; después incorpore main. Desde la raíz del repositorio ejecute `bash ios/bootstrap-xcode.sh --verify`. Si termina correctamente, ejecute `bash ios/bootstrap-xcode.sh` y seleccione su iPhone en Xcode. No hace falta cambiar claves del proveedor en el teléfono.

Prueba: diga una preferencia nueva sin pedir que se memorice; compruebe el mensaje en Historial compartido. Abra Telegram y pregunte por ella. Corríjala en web y abra una sesión de voz nueva. Pruebe una pausa a mitad de frase, una interrupción y la recuperación tras perder la red. Los mensajes deben indicar pendiente hasta que el servidor confirme la escritura. El botón Limpiar de la conversación solo limpia la pantalla; los registros se gestionan en Historial.

La memoria anterior de ChatGPT no se descarga automáticamente: solo está disponible el documento maestro ya importado y el historial que siga conservado en Zyron. Fotos, vídeos y otros adjuntos no se convierten por esta actualización en archivos archivados automáticamente.
