# ZYRON wake-first contract

La interfaz de voz principal de ZYRON no es Siri ni un atajo hablado de Apple.

## Experiencia objetivo

1. El companion mantiene la detección local de la palabra `ZYRON` cuando iOS lo permite.
2. El usuario dice `ZYRON` o `ZYRON, <orden>`.
3. Porcupine detecta el nombre en el dispositivo; el audio ambiente no se envía al núcleo cloud antes de la activación.
4. La capa local valida que se trata de una llamada directa y abre la sesión Realtime.
5. A partir de ahí el usuario conversa únicamente con ZYRON.
6. El núcleo puede consultar o ejecutar las herramientas autorizadas y devolver la respuesta a la misma conversación.
7. Al finalizar, el companion vuelve a escucha pasiva.

## Papel de Siri / App Intents

App Intents se conserva únicamente como infraestructura auxiliar para automatizaciones de iOS, diagnóstico y recuperación si el sistema ha suspendido el runtime. No debe presentarse como la puerta de entrada conversacional ni requerir frases del tipo `dile a ZYRON` o `pregunta a ZYRON`.

## Prioridad de desarrollo

La validación física prioritaria es:

- detección de `ZYRON` con pantalla encendida;
- activación directa y conversación Realtime;
- continuidad con pantalla bloqueada;
- retorno automático a escucha pasiva;
- recuperación tras interrupciones de audio o suspensión de iOS;
- reducción de falsos positivos y activaciones por menciones casuales.

Hasta validar estos puntos, nuevas integraciones de Siri no son una prioridad del producto.
