# Arquitectura de ZYRON

## Objetivo

ZYRON es un asistente personal privado, accesible desde móvil y web, cuyo núcleo no depende de una interfaz concreta de inteligencia artificial.

## Flujo actual

```text
PWA / navegador móvil
        |
        v
proxy.ts: autenticación privada
        |
        v
/api/chat: enrutador de intenciones
   |          |          |
   v          v          v
OpenAI       Mem0       Neon
conversación memoria    tareas
```

## Módulos actuales

### Autenticación

- Sesión firmada mediante cookie `HttpOnly`.
- Clave de propietario y secreto almacenados únicamente como variables de entorno.
- Rutas web privadas redirigidas a `/login`.
- Rutas API privadas bloqueadas con estado `401`.

### Conversación

- Contexto reciente limitado para controlar latencia y coste.
- Recuperación previa de recuerdos relevantes.
- Respuesta en castellano de España.
- Ninguna acción se confirma antes de haber sido ejecutada realmente.

### Memoria

- Mem0 almacena hechos, preferencias, proyectos, rutinas, objetivos y decisiones útiles.
- No debe guardar saludos, secretos ni texto transitorio.
- Los recuerdos recuperados son contexto, no una fuente infalible.

### Tareas

- Persistencia en Neon.
- Crear, listar, completar y eliminar.
- Enrutado determinista para órdenes claras.
- Clasificación mediante modelo para lenguaje natural ambiguo.
- Aclaración obligatoria cuando varias tareas coinciden.

### Voz

- Reconocimiento de voz del navegador cuando está disponible.
- Síntesis de voz española priorizada en el dispositivo.
- Estados visibles: escuchando, pensando y hablando.

## Reglas de seguridad

1. Nunca exponer claves con variables `NEXT_PUBLIC_*`.
2. Nunca registrar secretos en consola.
3. No ejecutar una operación destructiva con coincidencias ambiguas.
4. Validar entradas antes de acceder a la base de datos.
5. Mantener los conectores desacoplados del núcleo.
6. Comprobar el despliegue de Vercel después de cada cambio relevante.

## Próximos bloques

1. Fechas y horas naturales para tareas.
2. Objetivos y proyectos persistentes.
3. Panel revisable de memoria.
4. Google Calendar.
5. Gmail.
6. Ubicación, rutas y hora recomendada de salida.
7. Voz continua con control de interrupciones.
