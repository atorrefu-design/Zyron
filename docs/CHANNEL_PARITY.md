# Paridad de canales de ZYRON · auditoría v0.18

| Capacidad | Web | iOS companion | Telegram | Fuente común |
|---|---|---|---|---|
| Memoria | Lectura/escritura | Lectura/escritura | Lectura/escritura y comandos sin IA | PostgreSQL/Neon |
| Tareas | Listar/crear/completar/borrar | Núcleo común | Listar/crear/completar/planificar/borrar | PostgreSQL/Neon |
| Calendario | Lectura/escritura | Núcleo común | Lectura/escritura | Google + política común |
| Gmail | Lectura | Núcleo común | Lectura | Google + política común |
| Drive | Lectura/escritura limitada | Núcleo común | Lectura/escritura limitada | Google + política común |
| Ubicación/rutas | Según contexto | Nativa | Ubicación viva de Telegram + rutas | Contexto temporal + Google Maps |
| Información vigente | Web search | Núcleo común | Web search | Servicio común de búsqueda |
| Llamadas/SMS/apps/grabación | No ejecutable | Nativo autorizado | Requiere companion | iOS |

## Veredicto

Telegram ya funciona como adaptador del núcleo compartido para capacidades de servidor y memoria. No es —ni debe ser— un segundo ZYRON. La única diferencia legítima es la frontera física del dispositivo: un bot remoto no puede iniciar silenciosamente acciones protegidas del iPhone.

## Controles añadidos

- Contexto de canal explícito en el agente común.
- Borrado de tareas disponible con coincidencia única y confirmación posterior.
- Consulta de información vigente disponible desde el agente común.
- Comando `/capacidades` sin IA para mostrar el alcance real.
- Mensaje de sistema que prohíbe fingir acciones nativas desde Telegram.
