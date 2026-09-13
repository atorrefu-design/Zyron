# ZYRON: evolución hacia un asistente inspirado en JARVIS

Fecha de revisión: 13 de septiembre de 2026. Núcleo web: 0.26.0. El companion iOS tiene su ciclo de compilación e instalación independiente.

## Resultado y alcance

La decisión es evolucionar Zyron conservando su identidad, base de datos, permisos y conexiones. Reiniciar el proyecto perdería integraciones útiles sin resolver los fallos observados: confirmaciones que no llegan al ejecutor, diferencias entre canales y respuestas que prometen capacidades sin comprobarlas. La estética cinematográfica debe acompañar a un sistema fiable y verificable.

Esta entrega incorpora un panel oscuro con anillos cian animados, estados reales, controles de voz y movimiento, trato de usted, edición de recuerdos y una vía explícita de órdenes sin modelo generativo. Unifica la selección de proveedor del agente e incorpora configuración para un endpoint local compatible y Gemini directo. No conecta automáticamente cuentas nuevas, no concede permisos de iOS y no reproduce las capacidades ficticias de la película.

La conversación abierta requiere un modelo de lenguaje. Un conjunto definido de órdenes puede funcionar sin él. Un modelo local sigue siendo IA aunque no use un servicio de pago. La lectura de texto del navegador tampoco garantiza un motor concreto ni funcionamiento sin red: depende del sistema y de las voces instaladas.

## Método y límites de la investigación de vídeos

Se buscaron tutoriales en YouTube sobre asistentes JARVIS, ejecución local, Atajos y voz en iPhone. Se intentó consultar páginas de reproducción y obtener transcripciones. Las transcripciones no estuvieron disponibles en las páginas examinadas; una reproducción accesible mostraba un anuncio. Por ello, esta investigación NO constituye un visionado completo ni un análisis exhaustivo de las instrucciones de esos vídeos. No se atribuyen fragmentos de código, resultados de pruebas ni recomendaciones técnicas a contenido audiovisual que no se pudo comprobar.

El inventario permite continuar la revisión con transcripciones facilitadas por el usuario. Las decisiones implementadas se apoyan en la inspección del código de Zyron, las pruebas descritas abajo y documentación primaria accesible. Un título sugerente o una demostración editada no demuestra disponibilidad permanente, seguridad de escritura ni integración real con iOS.

| Vídeo localizado | Acceso conseguido | Utilidad para una revisión posterior |
| --- | --- | --- |
| [How to Create Your Own AI Assistant](https://www.youtube.com/watch?v=4WBOmhI11rQ) | Página; sin transcripción recuperable | Comparar alcance de la demostración con un producto persistente |
| [Build Your Own JARVIS AI Assistant](https://www.youtube.com/watch?v=VVNBiOkUJhA) | Metadatos de búsqueda | Revisar arquitectura y dependencias cuando haya contenido completo |
| [Jarvis Mark 51 Installation](https://www.youtube.com/watch?v=u6c-6RF6J_g) | Página; sin transcripción recuperable | Revisar instalación y requisitos reales |
| [Local Jarvis Installation](https://www.youtube.com/watch?v=lQl8jNI4TXc) | Página; anuncio visible; sin transcripción | Evaluar recursos locales, modelos y mantenimiento |
| [Jarvis on iPhone — Chrunos](https://www.youtube.com/watch?v=e6_e3Vf8Cxw) | Página; sin transcripción recuperable | Comparar Atajos con el companion existente |
| [iOS 18: How To Change Siri’s Name To Jarvis](https://www.youtube.com/watch?v=-XzZbG0LhMg) | Metadatos de búsqueda | Distinguir personalización de activación y capacidad funcional |
| [Make Your iPhone Assistant Sound Like Iron Man’s AI](https://www.youtube.com/watch?v=Nze6J73UK2A) | Metadatos de búsqueda | Evaluar voz, latencia y permisos sin asumir clonación |
| [TOP 10 AI-Powered Shortcuts for Your iPhone in 2024](https://www.youtube.com/watch?v=bzxN0cTeMXs) | Metadatos de búsqueda | Revisar vigencia de acciones y servicios |
| [Jarvis — Atalhos](https://www.youtube.com/watch?v=SaIjUdskxVs) | Metadatos de búsqueda | Revisar la composición de automatizaciones |

## Fundamentos contrastados

### iPhone, Bluetooth y aplicaciones

Atajos ofrece un disparador de conexión Bluetooth con selección de dispositivo. La automatización pertenece al iPhone y debe configurarse allí. Un despliegue de la web no instala esa automatización ni actualiza una app compilada con Xcode. La exposición de acciones propias se articula mediante App Intents/App Shortcuts. Estas son las piezas adecuadas para invocar el modo coche de Zyron; necesitan verificación en el teléfono instalado. Fuentes: [Apple, disparadores de ajustes](https://support.apple.com/guide/shortcuts/setting-triggers-apde31e9638b/ios), [AppShortcutsProvider](https://developer.apple.com/documentation/appintents/appshortcutsprovider).

Google Maps permite abrir destinos e indicaciones mediante URLs. La navegación puede abrirse como navegación activa o como vista previa según plataforma, ubicación y parámetros. Por tanto, recibir una URL correcta no prueba que haya comenzado una guía de voz. El criterio de aceptación es comprobar el resultado en el dispositivo. Fuente: [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

Telegram entrega mensajes y otros tipos de actualización a un bot. Es un canal hacia el núcleo: no proporciona por sí mismo acceso general al micrófono, contactos o aplicaciones instaladas del teléfono. La ubicación recibida depende de lo que el usuario comparte y de sus actualizaciones. Fuente: [Telegram Bot API](https://core.telegram.org/bots/api#message).

### Conversación y voz

La API Realtime permite sesiones de audio, detección de turnos y gestión de interrupciones. Su comportamiento depende del transporte y del cliente. La selección de voz queda vinculada a la sesión una vez producido audio; debe abrirse una sesión nueva para cambiarla. Zyron utiliza una voz disponible del proveedor e instrucciones de estilo; esto no garantiza identidad vocal con un actor ni acento exacto en cada respuesta. Fuente: [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).

Home Assistant documenta una alternativa local compuesta por reconocimiento, procesamiento de órdenes y síntesis. Speech-to-Phrase cubre un vocabulario de comandos limitado; Whisper permite entradas más abiertas con mayores necesidades de cómputo; Piper aporta síntesis local. Es una referencia útil para una futura estación doméstica, pero no queda instalada por añadir una opción de proveedor a Zyron. Fuente: [Home Assistant, voz local](https://www.home-assistant.io/voice_control/voice_remote_local_assistant/).

### Modelos locales y opciones gratuitas

Ollama implementa compatibilidad con parte de la API de OpenAI. Esa compatibilidad permite reutilizar un cliente, pero no asegura que cualquier modelo soporte herramientas o siga instrucciones con igual fiabilidad. El servidor y el modelo deben existir y resultar accesibles desde quien hace la llamada. Fuente: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

Gemini dispone de un endpoint compatible con OpenAI que requiere una clave. Su disponibilidad gratuita está sujeta a modelos, cuotas y condiciones del servicio; no equivale a capacidad ilimitada ni a aprovechar automáticamente la sesión de una app móvil. Fuentes: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [precios y condiciones](https://ai.google.dev/gemini-api/docs/pricing), [límites](https://ai.google.dev/gemini-api/docs/rate-limits).

## Arquitectura elegida

Web, Telegram y companion deben identificar al mismo propietario y llegar al mismo núcleo. Ese núcleo contiene memoria persistente, permisos, ejecución de herramientas, auditoría y una capa opcional de conversación. El canal adapta la entrada y la salida, pero no inventa su propia memoria ni decide que una operación tuvo éxito sin resultado del ejecutor.

La ruta determinista se ejecuta antes de pedir una respuesta a un modelo. Si reconoce una orden soportada, llama a la herramienta correspondiente. Si no reconoce la petición y la IA está desactivada, explica la limitación sin recurrir silenciosamente a otro proveedor. La vía conversacional utiliza las mismas herramientas y controles de escritura.

Una acción consta de intención, destino, parámetros, autorización, ejecución y resultado. Para resolver el patrón de errores de las capturas, las confirmaciones deben conservar su relación con la operación pendiente. Una letra «A» no autoriza cualquier acción antigua. Los reintentos de una actualización de Telegram necesitan una clave estable para evitar duplicar su escritura. Las operaciones nuevas siguen siendo independientes.

## Cambios de esta entrega

| Área | Implementado en código | Qué queda por comprobar o configurar |
| --- | --- | --- |
| Aspecto | Anillos geométricos animados, paleta cian/negro, disposición adaptable, enlaces reales, pausa y reducción de movimiento | Revisión visual interactiva en navegador de producción |
| Personalidad | Instrucción compartida de trato de usted, señor con moderación, tono sereno y respuestas verificables | Escucha en iPhone y valoración personal del timbre/acento |
| Voz | Estilo compartido, voz Realtime cedar, lectura opcional del texto y cancelación al iniciar sesión de voz | Micrófono, permisos, interrupciones y latencia con hardware real |
| Sin IA | Interruptor web y prefijo Telegram `/sin_ia`; bloqueo explícito del agente generativo cuando se solicita | Cada servicio de datos sigue necesitando su conexión |
| Memoria | Edición en `/memory`, comparación atómica contra contenido previo y error de conflicto; historial inmediato anterior en metadatos | Escritura/lectura real en la base de producción y coherencia entre sesiones |
| Telegram | Mejor reconocimiento contextual de confirmación de memoria; idempotencia por actualización; tiempo por ruta directa | Envío y recepción reales del bot con el propietario |
| Proveedores | Cliente compartido; endpoint local y Gemini directo configurables; sin sustitución silenciosa de local por nube | Credenciales, conectividad, modelo con herramientas y prueba de inferencia |
| Conexiones | Panel `/connections` con estados y enlaces de configuración | Una clave configurada no demuestra servicio saludable |
| Modo coche | Se conserva la corrección iOS 0.7.2 previamente incorporada a main | Recompilar/instalar y comprobar App Shortcuts y Bluetooth en iPhone |

### Memoria: garantías y límites

Editar un recuerdo exige el contenido que el editor vio. Si otro canal lo cambió mientras tanto, la actualización no lo pisa: se devuelve un conflicto para volver a cargarlo. Se limita el tamaño a 8.000 caracteres. Se conserva la versión inmediatamente anterior en metadatos, no un historial completo con interfaz de restauración.

La deduplicación incorporada afecta al reintento de la misma actualización Telegram. Dos mensajes nuevos e intencionales pueden crear recuerdos separados. No se promete deduplicación semántica universal. Un recuerdo importado editado en la base tampoco modifica automáticamente su documento fuente; una nueva importación necesita revisión.

La edición de esta entrega está disponible en el panel web. No se presenta como una nueva herramienta conversacional universal de edición en todos los canales. La lectura y el guardado existentes usan la memoria compartida; cualquier ampliación de edición por voz debe preservar la comprobación de versión y la autorización explícita.

### Modo sin IA: significado exacto

El interruptor evita el procesamiento generativo en las rutas verificadas `/api/agent` y `/api/act`. No convierte consultas arbitrarias en órdenes entendibles: si una petición no encaja en una ruta implementada, se detiene con una explicación. Guardar una instrucción textual explícita y consultar datos mediante código no exige un modelo de lenguaje.

En Telegram, `/sin_ia` debe preceder al texto de la orden. Una nota de voz puede necesitar transcripción antes de reconocer ese prefijo; no debe presentarse como consumo cero. La voz Realtime sigue siendo una función con IA. La lectura del navegador es una opción independiente cuya implementación depende del dispositivo.

## Activación de proveedores opcionales

La selección de motor utiliza el cliente compartido del agente. No se han creado cuentas ni añadido claves durante esta entrega. Antes de activar un proveedor hay que comprobar sus condiciones y realizar una petición real sin datos personales de prueba.

Para un servidor local compatible:

```text
ZYRON_LOCAL_BASE_URL=https://<servidor-accesible>/v1
ZYRON_LOCAL_MODEL=<modelo-instalado>
ZYRON_LOCAL_API_KEY=<si-el-servidor-la-requiere>
ZYRON_DEFAULT_AI_PROVIDER=local
```

En Vercel, `localhost` designa la máquina que ejecuta la función, no el Mac del usuario. Hace falta un endpoint accesible, autenticado y administrado por el propietario, o ejecutar el núcleo en la misma red que el servidor local. No publicar un servidor de inferencia sin controles para resolver esta conectividad. El proveedor local configurado no cambia automáticamente la voz Realtime.

Para Gemini directo:

```text
GEMINI_API_KEY=<clave-del-proyecto>
ZYRON_GEMINI_DIRECT_MODEL=<modelo-disponible-en-su-cuenta>
```

El modelo por defecto del adaptador es configurable. Debe verificarse su disponibilidad en la cuenta en el momento de activarlo. Una app de Claude, Gemini u otro asistente instalada en el teléfono no concede una API al backend de Zyron. Las integraciones precisan una API admitida, un enlace o una acción de Atajos que esa app publique. No se automatizan sesiones privadas para eludir sus límites.

## Verificación realizada

La batería de `tests/channels/*.test.mts` terminó con 68 pruebas aprobadas y cero fallos. Incluye reconocimiento de confirmaciones de memoria y selección de proveedor. TypeScript sin emisión terminó correctamente. La compilación optimizada de Next.js terminó correctamente y generó las 71 páginas indicadas por el compilador.

El nuevo `tests/integration/no-ai-smoke.mjs` arranca un servidor aislado sin credenciales reales ni base de producción. Comprueba rechazo anónimo, autenticación de prueba, negativa a ejecutar IA en `/api/agent` y `/api/act`, rechazo de una edición vacía y respuesta HTTP correcta del inicio, conexiones y memoria. Se ejecutó con éxito dos veces. Estos resultados demuestran comportamiento de esas rutas, no que todas las aplicaciones externas funcionen.

La captura visual estática local no pudo abrirse: la política de seguridad del navegador bloqueó la URL de archivo. No se intentó sortear el bloqueo. La generación HTML y la compilación sí se comprobaron; no se afirma validación visual completa ni hidratación interactiva. No se realizaron llamadas de voz reales, escrituras de memoria en producción, activaciones Bluetooth ni pruebas de Xcode en este entorno. El acceso del conector a la lista de despliegues de Vercel devolvió un rechazo de permisos; el estado publicado por Vercel en GitHub es una comprobación independiente de despliegue, no una prueba funcional de todas las herramientas.

## Criterios para dar por operativa la experiencia completa

1. Abrir el panel en iPhone y escritorio; confirmar controles legibles, estados correctos y movimiento pausado cuando se solicita.
2. Desactivar IA; ejecutar una orden soportada y otra abierta. La segunda debe informar de la limitación sin consumir un modelo generativo.
3. Guardar un dato de prueba en Telegram, leerlo en web, editarlo en memoria y recuperarlo desde otra sesión. Después eliminar el dato de prueba.
4. Abrir el mismo recuerdo en dos editores, guardar cambios distintos y comprobar que el segundo recibe un conflicto.
5. Mantener una conversación de voz, interrumpir una respuesta y cambiar de tema. Medir latencia y comprobar que no habla simultáneamente la lectura del navegador.
6. Instalar el companion actualizado; localizar «Modo coche ZYRON» en Atajos. Conectar al Bluetooth elegido, escuchar el saludo según la hora, dictar un destino y verificar el resultado en Google Maps.
7. Probar cada conexión con lectura y una escritura explícita reversible; comprobar su resultado en la aplicación de destino. Un indicador «configurado» no sustituye esta prueba.

## Próximas ampliaciones justificadas

La prioridad es medir y resolver los fallos de los recorridos anteriores antes de añadir servicios. Después pueden incorporarse edición conversacional con control de versión, notificaciones proactivas configurables, servidor de voz local y más conectores con permisos delimitados. Home Assistant resulta interesante si el usuario dispone de dispositivos compatibles y un servidor encendido; no es un requisito del panel web.

Para lograr una sensación más cercana a JARVIS conviene mejorar continuidad, turnos, tiempo hasta la primera respuesta y confirmación de acciones. Los adornos visuales no deben ocultar errores ni retrasar el acceso a tareas. La interfaz muestra estados derivados del sistema y evita porcentajes decorativos de inteligencia o capacidades inexistentes.

El objetivo técnico alcanzable es un asistente personal con presencia visual, voz coherente y herramientas compartidas, cuya autonomía se apoye en permisos reales. La equivalencia absoluta con el personaje de ficción y el acceso perfecto a cualquier aplicación no son criterios que esta entrega pueda garantizar.
