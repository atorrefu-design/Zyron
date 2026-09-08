# Contextos Bluetooth de ZYRON · v0.24

## Funcionamiento

iOS detecta la conexión mediante una automatización personal de Bluetooth y ejecuta el App Intent `Contexto Bluetooth ZYRON`. El companion envía al núcleo privado:

- contexto: coche, auriculares, trabajo, casa u otro;
- función: briefing, plan del día, diagnóstico o solo contexto;
- nombre opcional del dispositivo.

El evento y la función son deterministas y no usan IA. El contexto queda temporalmente disponible para web, companion y Telegram. Caduca automáticamente para evitar que ZYRON presuponga que el dispositivo continúa conectado.

## Configuración en el iPhone

1. Abre Atajos > Automatización > `+` > Bluetooth.
2. Elige el dispositivo concreto y el disparador al conectarse.
3. Selecciona ejecutar inmediatamente.
4. Añade la acción de la app `Contexto Bluetooth ZYRON`.
5. Elige el contexto y la función deseados.
6. Escribe el nombre del dispositivo si quieres identificarlo en el historial.

Apple exige que el propietario seleccione el dispositivo y autorice la automatización. ZYRON no intenta enumerar todos los dispositivos Bluetooth ni mantener una vigilancia Bluetooth clásica cuando la app está cerrada.

## Modo coche con Google Maps

Para el flujo de conducción usa la acción `Iniciar modo coche ZYRON`, no la acción genérica de contexto:

1. En Atajos > Automatización crea un disparador `Bluetooth` para el coche.
2. Marca `Ejecutar inmediatamente` y desactiva `Notificar al ejecutar` si iOS ofrece esa opción.
3. Añade la acción `Iniciar modo coche ZYRON`.
4. La automatización abre el companion porque iOS exige que una conversación WebRTC con micrófono pertenezca a la app visible.
5. ZYRON saluda según la hora de Barcelona, pregunta el destino y escucha la respuesta.
6. Al recibir el destino abre Google Maps directamente en modo conducción. Si la app no está instalada, usa la ruta web de Google Maps como respaldo.

El saludo usa estos tramos: días de 05:00 a 13:59, tardes de 14:00 a 20:59 y noches de 21:00 a 04:59.

## Valores recomendados

| Dispositivo | Contexto | Función inicial |
|---|---|---|
| Coche | Coche | Preparar briefing |
| Auriculares | Auriculares | Solo activar contexto |
| Altavoz del trabajo | Trabajo | Preparar plan del día |
| Altavoz de casa | Casa | Solo activar contexto |
