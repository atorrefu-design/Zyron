# ZYRON 0.27 — continuidad y preparación de iPhone 0.8.0

## Qué cambia

La memoria de trabajo incorpora un historial persistente común para los mensajes de la web, las transcripciones finales de la voz web y nativa, y los mensajes que el canal Telegram registra. Los hechos del documento maestro y las memorias explícitas existentes se conservan. El nuevo registro guarda autor, canal, fecha e identificador; no necesita llamar a una IA para guardar ni buscar texto.

El código incorpora una migración única del historial Telegram que todavía exista y pertenezca a la cuenta vinculada. No puede recuperar mensajes eliminados anteriormente por la retención de 30 días. La migración se ejecuta al consultar el nuevo historial o al construir contexto; su resultado real depende del acceso a PostgreSQL. Se ha retirado el borrado periódico de conversaciones del canal.

La web conserva mensajes pendientes en su almacenamiento local; los reintenta al volver a conectar, abrir el panel o pulsar sincronización. La app guarda una cola protegida en Application Support, excluida de las copias de seguridad, y la envía al registrar otro turno, al volver a primer plano o al pulsar sincronización. El servidor deduplica por identificador. No desinstalar ni borrar datos del dispositivo mientras haya mensajes pendientes. Las copias locales pendientes dependen de que el dispositivo permita escribir en su almacenamiento: el panel muestra el error si no es posible.

## Aprendizaje contextual

Las preferencias y correcciones expresadas de forma directa se identifican mediante reglas, sin una llamada adicional a un modelo. Al responder, Zyron recupera episodios recientes, resultados de búsqueda y señales de preferencias. Distingue las afirmaciones del propietario de las respuestas generadas. Una corrección posterior puede prevalecer sobre una afirmación incompatible anterior; la instrucción al modelo exige pedir aclaración ante ambigüedad.

Esto es adaptación mediante recuperación de contexto, no entrenamiento autónomo del modelo ni comprensión perfecta. La detección por reglas es limitada y la búsqueda es textual en español. No altera automáticamente los planos maestros ni ejecuta instrucciones antiguas recuperadas. No modifica el documento maestro a partir de hipótesis. El contexto de cada respuesta tiene un presupuesto de longitud: se conserva más información de la que cabe en una única respuesta.

El panel `/history` permite buscar, paginar, corregir y borrar mensajes. La edición compara el contenido anterior para evitar pisar otra modificación concurrente. Borrar un mensaje no borra automáticamente una memoria explícita separada, una copia en Telegram ni los datos fuente de un archivo. Limpiar pantalla y `/reset` mantienen el historial persistente; no equivalen a borrar recuerdos.

En texto, `historial` y `busca en el historial: palabras` consultan conversaciones sin modelo. También pueden usarse detrás del prefijo `/sin_ia` de Telegram.

## Voz

La voz web ahora solicita transcripción de entrada. Ambas sesiones cargan memoria e historial al comenzar. La consulta nativa pasa al núcleo `/api/agent` y conserva los últimos turnos de la conversación. Se mantiene la voz cedar y el trato de usted con instrucciones de español peninsular.

Se cambia la detección de fin de turno de un silencio fijo corto a `semantic_vad` con `eagerness: medium`. Este modo decide cuándo parece terminada la intervención y permite interrupciones; puede esperar más ante una frase incompleta. La interfaz escucha los eventos de reproducción para reflejar cuándo termina el audio. Referencia: [OpenAI, detección de voz](https://developers.openai.com/api/docs/guides/realtime-vad).

Las transcripciones finales se deduplican mediante `item_id`. Se guarda texto recibido, no el archivo de audio ni una garantía de todo lo que el usuario llegó a oír antes de una interrupción. El orden de llegada de transcripciones puede diferir del orden del habla; las fechas registran recepción. Referencia: [OpenAI, transcripción Realtime](https://developers.openai.com/api/docs/guides/realtime-transcription).

El timbre, el acento exacto, el Bluetooth y la fluidez solo pueden comprobarse escuchando el teléfono. El acceso o la cuota del proveedor pueden impedir crear una sesión. Estos cambios no eliminan el coste de la conversación con IA ni de su transcripción.

## Preparar el Mac

1. Conserve los cambios propios hechos con Claude antes de actualizar el repositorio.
2. Incorpore los cambios de `main` y abra la carpeta del repositorio.
3. Ejecute `bash ios/bootstrap-xcode.sh --verify` para generar y compilar el proyecto de simulador.
4. Ejecute `bash ios/bootstrap-xcode.sh`, seleccione el target ZYRON y el equipo de firma, conecte el iPhone y pulse Run.
5. Compruebe versión **0.8.0**, compilación **3**. No compile CloudSmoke: es una app de pruebas diferente.
6. Inicie sesión y compruebe Memoria compartida. Conserve la automatización de modo coche y actualice el catálogo de Atajos desde la app.

El repositorio conserva el workflow de compilación iOS. La compilación local con Xcode no se ha ejecutado en el entorno Linux de edición. Un build web correcto no valida Swift, firma, permisos ni audio.

## Pruebas efectuadas antes de publicar

- 72 pruebas de canal/políticas/colas: aprobadas.
- TypeScript: aprobado.
- Build optimizado Next.js: aprobado.
- HTTP aislado: autenticación exigida; entradas inválidas rechazadas; un servidor sin base de datos devuelve error y nunca confirma guardado; inicio, conexiones, memoria e historial responden.
- Cola web: un fallo conserva mensajes; el reintento mantiene identificadores; un mensaje nuevo durante una subida no se pierde.
- Se incluyen pruebas Swift para identidad de transcripciones y eventos de reproducción; pendientes de ejecución en Xcode.

No se ha hecho una escritura de prueba en la base de producción, ni una llamada real de voz, ni una prueba de hardware iPhone. La revisión visual interactiva sigue pendiente. Estas limitaciones no se sustituyen por el número de tests.

## Prueba al instalar

Diga una preferencia nueva sin «guárdalo». Verifique el texto en Historial. Pregunte por ella desde Telegram. Corríjala en web, abra una nueva sesión de voz y compruebe que usa la corrección. Desconecte la red durante un turno: debe aparecer pendiente; reconecte y pulse sincronizar. La misma transcripción no debe duplicarse. Pruebe pausas, interrupciones y Bluetooth por separado.

## Información histórica que aún falta

No existe acceso automático a todas las conversaciones de ChatGPT, a las apps externas ni a sus archivos. Se utiliza el documento maestro ya importado y lo realmente conservado en Zyron. Para incorporar conversación antigua que solo exista en ChatGPT hace falta una exportación o documento importable en Memoria. Esta entrega no archiva automáticamente imágenes, vídeos, binarios ni adjuntos de formatos que el canal todavía no admite.
