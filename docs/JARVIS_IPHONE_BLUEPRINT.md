# ZYRON · Blueprint JARVIS para iPhone

## Decisión

No se sustituye ni se reinicia ZYRON. Los vídeos de “JARVIS en iPhone” muestran tres enfoques:

1. **ChatGPT/Siri renombrado**: un atajo abre una app y reproduce una voz. Es una demostración visual, no un asistente independiente. No se adopta.
2. **Botón o acceso rápido + agente**: una entrada de iOS lanza un asistente y le pasa voz o texto. Se adopta como puerta de entrada, no como núcleo.
3. **Voz en tiempo real + herramientas**: un cliente móvil conecta por WebRTC/LiveKit a un agente con funciones, contexto y servicios. Es el patrón correcto y ya coincide con la arquitectura de ZYRON.

## Vídeos revisados

| Vídeo | Patrón útil | Aplicación en ZYRON |
|---|---|---|
| [The Ultimate iPhone Hack? My Action Button AI Agent](https://www.youtube.com/watch?v=_A6alsjnLfU) | Acceso rápido configurable mediante iOS Shortcuts | `TalkToZyronIntent`; asignable a Atajos, pantalla bloqueada, Back Tap o botón Acción compatible |
| [How to Build Your Own JARVIS AI Agent 100% Free](https://www.youtube.com/watch?v=An4NwL8QSQ4) | Voz en tiempo real, prompt, herramientas asíncronas, token server y cliente móvil | WebRTC nativo + `/api/realtime/native-call` + catálogo de capacidades |
| [How I Turned ChatGPT Into My Real-Time Voice Assistant](https://www.youtube.com/watch?v=e9Ndy4w9u58) | Conversación natural, interrupción, skills y ejecución mientras el usuario sigue con otra tarea | Interrupción WebRTC, skills contextuales y trazas de herramientas |
| [How to Easily Turn ChatGPT into JARVIS](https://www.youtube.com/watch?v=J50jVC7lkpU) | Personalidad y lanzamiento rápido | Solo se conserva la idea de acceso; no se convierte ChatGPT en fuente de identidad o memoria |
| [Open-source real-time voice agent](https://github.com/Tylarcam/jarvis_voice_agent) | Separación de voz, prompt y funciones | Se conserva el patrón modular; se rechazan credenciales en el cliente y memoria fragmentada |

## Arquitectura objetivo

```text
Entrada iPhone
Atajo · Lock Screen · Back Tap · app · voz local
                 │
                 ▼
        Companion nativo ZYRON
       micrófono · audio · permisos
                 │ WebRTC
                 ▼
          Núcleo cloud único
    identidad · memoria · políticas · agente
                 │
                 ▼
     Capacidades y conectores reales
 tareas · calendario · Drive · Gmail · mapas · web · dispositivo
```

Telegram, web e iOS entran en el mismo núcleo. Ninguna interfaz mantiene otra memoria o personalidad.

## Proceso de construcción adaptado

### 1. Entrada inmediata

- `TalkToZyronIntent` abre el companion y deja marcada la orden de iniciar voz.
- El controlador consume la marca al activarse y conecta WebRTC.
- El acceso puede colocarse en un Atajo, widget, pantalla bloqueada o Back Tap. El botón Acción es opcional y solo existe en modelos compatibles.
- iOS puede exigir desbloqueo para usar micrófono o abrir la app; ZYRON no debe prometer eludir esa protección.

### 2. Conversación natural

- Audio por WebRTC, salida por altavoz/Bluetooth/CarPlay según la ruta activa.
- Interrupción: Aarón puede cortar la respuesta hablando.
- Confirmación audible únicamente para acciones sensibles.
- Respuesta breve por defecto y castellano de España.

### 3. Herramientas antes que conversación

- Órdenes deterministas se resuelven sin IA y registran `creditsUsed:false`.
- El modelo se usa para interpretar ambigüedad, planificar o sintetizar, no para simular resultados.
- Cada herramienta devuelve éxito o error real antes de que ZYRON responda.
- La política de confirmación es común a web, app, voz y Telegram.

### 4. Memoria común

- PostgreSQL/Neon es la única memoria canónica.
- El canal aporta contexto temporal, nunca una memoria paralela.
- Los hechos permanentes se guardan solo por petición explícita.

### 5. Percepción y contexto

- Ubicación actual autorizada y sin historial.
- Cámara o pantalla únicamente cuando Aarón active una sesión visual y conceda permiso.
- Archivos y grabaciones mediante selección o Share Sheet, no inspección silenciosa de otras apps.

### 6. Proactividad controlada

- Cero procesos automáticos por defecto.
- Automatizaciones solo tras una orden explícita, con ámbito, frecuencia y forma de detenerlas visibles.
- Las acciones sobre terceros mantienen confirmación o handoff de iOS.

## Estado frente al patrón de los vídeos

| Bloque | Estado |
|---|---|
| Núcleo independiente de una app de IA | Operativo |
| Memoria privada común | Operativa |
| Herramientas reales de servidor | Operativas, ampliables |
| Telegram como extensión | Operativo |
| Voz WebRTC nativa | Implementada; falta validación física final |
| Entrada rápida por App Intent | Corregida; requiere recompilar el companion |
| Activación fiable con iPhone bloqueado | Limitada por iOS; pendiente de prueba física |
| Visión por cámara/pantalla | Pendiente y siempre bajo permiso explícito |

## Próxima validación en iPhone

Cuando haya acceso al Mac:

1. recompilar e instalar el companion;
2. ejecutar **Hablar con ZYRON** desde Atajos;
3. asignarlo a pantalla bloqueada o Back Tap y, si el modelo lo admite, al botón Acción;
4. confirmar que abre ZYRON e inicia WebRTC una sola vez;
5. probar audio con pantalla activa, bloqueada, Bluetooth y CarPlay;
6. validar una lectura, una orden determinista sin IA y una escritura con confirmación.
