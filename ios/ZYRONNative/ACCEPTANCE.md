# ZYRON Native — acceptance checklist

## Gate 1: audio nativo con pantalla bloqueada

- Iniciar una conversación en modo audio.
- Bloquear manualmente el iPhone mientras ZYRON habla.
- Confirmar que la salida de audio continúa.
- Hablar sin desbloquear el iPhone.
- Confirmar que ZYRON recibe el turno y responde.
- Repetir con auriculares Bluetooth si están disponibles.

Resultado mínimo para continuar: entrada y salida de audio sobreviven al bloqueo manual durante al menos 2 minutos.

## Gate 2: horario silencioso

- Forzar `ZyronResponseMode.text` sin cambiar la hora real del teléfono.
- Realizar una petición con la pantalla bloqueada.
- Confirmar que no se reproduce audio.
- Confirmar que la respuesta aparece como notificación silenciosa de ZYRON.
- Confirmar que al volver a modo `audio` la conversación vuelve a hablar.

## Gate 3: activación por nombre

Debe activar:
- `ZYRON, dime qué tengo mañana.`
- `Oye ZYRON, busca una farmacia cerca.`
- `ZYRON` seguido de una pausa clara.

No debe activar:
- `Ayer estaba hablando de ZYRON.`
- `La app ZYRON está en desarrollo.`
- `He dicho ZYRON varias veces.`

Tras activación, no debe exigir repetir `ZYRON` en cada turno.

## Gate 4: cierre natural

- `ZYRON, termina` cierra de inmediato.
- `Hasta luego` cierra de inmediato.
- `Gracias` inicia cierre suave y permite continuar si se vuelve a hablar durante los siguientes 5 segundos.
- 45 segundos de silencio devuelven al modo pasivo.

## Gate 5: herramientas

Durante Realtime nativo:
- una consulta de agenda/datos privados debe usar el núcleo de ZYRON;
- una búsqueda de negocios debe devolver Google Places reales;
- `cerca de mí` debe poder usar la ubicación del iPhone;
- ninguna API key permanente debe existir dentro de la app.

## Gate 6: interrupciones

- Interrumpir la sesión con Siri y volver.
- Probar cambio altavoz ↔ Bluetooth.
- Probar una llamada entrante si es posible.
- Confirmar que ZYRON recupera la sesión o vuelve limpiamente al detector pasivo.

## Gate 7: contactos y comunicaciones

- En la tarjeta «Contactos y comunicaciones», autorizar solo los contactos elegidos cuando iOS ofrezca acceso limitado.
- Decir \`ZYRON, llama a Sarai\` y confirmar que iOS prepara la llamada al contacto correcto.
- Si existen contactos duplicados, confirmar que ZYRON pide el nombre completo y no escoge uno por su cuenta.
- Si un contacto tiene varios teléfonos, confirmar que ZYRON pide concretar y no utiliza el primero automáticamente.
- Decir \`ZYRON, escribe a Laura por WhatsApp que llegaré tarde\`.
- Confirmar que WhatsApp se abre con destinatario y texto preparados, pero que ZYRON no pulsa Enviar.
- Decir \`ZYRON, envía un SMS a mamá diciendo ya he llegado\`.
- Confirmar que Mensajes se abre con el borrador y requiere pulsar Enviar.
- Revocar Contactos en Ajustes y confirmar que ZYRON explica el bloqueo sin afirmar que preparó ninguna acción.

## Fallback del sistema

Si iOS termina la escucha permanente, el App Shortcut `Activar ZYRON` debe poder volver a abrir la app mediante Siri/Atajos. Este fallback no sustituye al detector local 24/7; solo recupera la app cuando el sistema la haya detenido.
