# Arquitectura de ZYRON

## Principio

ZYRON es un único asistente personal privado. Web, app iOS, voz y Telegram son adaptadores de entrada y salida; no poseen una identidad, memoria ni reglas propias.

## Núcleo actual

```text
Web/PWA ────────────────┐
iOS / voz ─────────────┼──► políticas + agente ZYRON ──► herramientas autorizadas
Telegram ──────────────┘              │
                                      └──► PostgreSQL/Neon
                                           memoria, tareas, auditoría y canales
```

- La memoria canónica reside en las tablas `zyron_memory_*` de PostgreSQL/Neon.
- Las tareas, vínculos de canales, ubicación temporal y auditoría residen en el mismo backend.
- El agente común ejecuta tareas, calendario, Gmail, Drive, mapas e información actual.
- Las rutas deterministas de memoria en Telegram leen o escriben la misma memoria sin invocar IA.
- Los conectores externos no son fuentes alternativas de verdad.

## Frontera del dispositivo

Las acciones de servidor pueden iniciarse desde cualquier canal autorizado. Las acciones propias de iOS —abrir apps, llamadas, SMS, WhatsApp, grabación, contactos y notificaciones— solo pueden ejecutarse cuando el companion está presente y autorizado. Telegram debe explicarlo y nunca simular una ejecución.

## Confirmaciones

- Lecturas y acciones reversibles de bajo riesgo se ejecutan de forma inmediata.
- Crear eventos y archivos en Drive requiere resumen y confirmación posterior.
- Eliminar tareas o eventos requiere una coincidencia única y confirmación posterior.
- Enviar mensajes a terceros, cambiar permisos o ejecutar acciones arbitrarias no forma parte del núcleo autorizado.

## Reglas operativas

1. Todos los canales utilizan la misma memoria y políticas.
2. Ninguna acción se anuncia como realizada antes del resultado real de la herramienta.
3. No hay procesos autónomos o reintentos en segundo plano salvo petición explícita del propietario.
4. Las claves permanecen exclusivamente en variables de entorno del servidor.
5. Cada escritura relevante deja una traza de auditoría sin secretos ni coordenadas.
6. La ubicación de Telegram conserva solo la observación vigente, nunca un historial.

## Deuda conocida

La interfaz web histórica aún contiene rutas deterministas propias en `/api/chat`. Debe migrarse gradualmente al mismo catálogo del agente sin interrumpir las funciones ya operativas. Telegram y el fallback del companion ya ejecutan el núcleo común.
