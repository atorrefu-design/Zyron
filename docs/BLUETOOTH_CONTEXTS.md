# Contextos Bluetooth de ZYRON · v0.23

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

## Valores recomendados

| Dispositivo | Contexto | Función inicial |
|---|---|---|
| Coche | Coche | Preparar briefing |
| Auriculares | Auriculares | Solo activar contexto |
| Altavoz del trabajo | Trabajo | Preparar plan del día |
| Altavoz de casa | Casa | Solo activar contexto |
