# ZYRON Voice Activation v1.0

## Principio

El nombre `ZYRON` no abre una sesión remota por sí solo. El iPhone detecta localmente un candidato de wake word y conserva solo una ventana breve de contexto local para decidir si Aarón está llamando al asistente o simplemente mencionándolo.

Mientras la conversación no está activa, el audio ambiente no se envía a OpenAI.

## Estados

1. `passive`: detector local esperando `ZYRON`.
2. `candidate`: se ha detectado `ZYRON`; se espera hasta 1,8 s de contexto local.
3. `active`: conversación Realtime abierta. Ya no hace falta repetir `ZYRON`.
4. `ending`: cierre explícito o por inactividad.
5. `passive`: regreso silencioso al detector local.

## Reglas de activación

Activar:
- `ZYRON, dime qué tengo mañana.`
- `Oye ZYRON, busca una farmacia cerca.`
- `ZYRON` seguido de una pausa clara de al menos 250 ms.

No activar:
- `Ayer estaba hablando de ZYRON con Sarai.`
- `La app ZYRON todavía está en desarrollo.`
- `He dicho ZYRON varias veces.`

Durante una conversación activa:
- cualquier frase continúa el turno sin repetir el nombre;
- `ZYRON, termina`, `hasta luego` o `puedes descansar` cierran inmediatamente;
- `gracias`, `ya está` o `eso es todo` se consideran cierre suave;
- 45 segundos de silencio completo devuelven ZYRON a modo pasivo.

## Horario de respuesta

- 07:00–00:59, hora de Madrid: audio.
- 01:00–06:59: respuesta silenciosa por texto/notificación.

El horario solo cambia el canal de salida. La lógica de activación es la misma.

## Privacidad y coste

El detector de wake word y la comprobación inicial de contexto deben ejecutarse localmente. Solo después de una invocación válida se abre la sesión remota. Esto evita transmitir audio ambiente 24/7, reduce consumo de datos y limita el coste de Realtime a conversaciones reales.

## Contrato con la app nativa

El backend expone:
- `GET /api/voice/policy`: horario, modo de respuesta y constantes de engagement.
- `POST /api/voice/activation`: clasificador de referencia para pruebas y paridad con la lógica local.

La implementación final de iPhone debe replicar estas reglas localmente para que la activación no dependa de red.
