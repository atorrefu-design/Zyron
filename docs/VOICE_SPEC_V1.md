# ZYRON Voice Spec v1.0

## Goal
ZYRON should behave as an always-available personal voice assistant, inspired by the interaction model of fictional assistants such as JARVIS or EDITH, while respecting iOS technical and privacy constraints.

## Core interaction
- The user should not need to open the app or press a button for normal voice interaction.
- ZYRON should maintain an always-ready listening mode whenever iOS allows it.
- The wake word is `ZYRON`.
- Detection of the wake word should happen locally on the iPhone whenever possible. Audio should not be continuously streamed to the cloud while waiting for the wake word.
- After detecting `ZYRON`, the app should capture the following utterance and start/continue a Realtime conversation.
- The conversation should remain continuous and support interruption while ZYRON is speaking.
- When the interaction finishes, ZYRON returns to wake-word listening mode.

## Direct-address discrimination
ZYRON must distinguish between being directly invoked and its name merely being mentioned in another conversation.

Examples that should activate:
- `ZYRON, dime qué tengo hoy.`
- `ZYRON, busca una farmacia cerca.`
- `ZYRON... ¿a qué hora tengo que salir mañana?`

Examples that should normally not activate:
- `Ayer le pregunté a ZYRON por el tráfico.`
- `Estábamos hablando de cómo funciona ZYRON.`

The wake-word layer should use acoustic timing plus a short local/contextual intent check after the keyword to decide whether the user is addressing the assistant.

## Output policy
Timezone: `Europe/Madrid`.

- From 07:00 inclusive until 01:00 exclusive: replies to voice invocations are spoken aloud by default, including when the phone is locked whenever iOS permits background audio.
- From 01:00 inclusive until 07:00 exclusive: ZYRON must not produce spoken replies. It should answer in text, preferably through the app and/or a lock-screen notification when appropriate.
- A typed request remains a text interaction unless the user explicitly asks for audio.

## Locked-screen behavior
Target behavior:
- ZYRON continues speaking while the iPhone is locked.
- ZYRON continues listening for conversation and, ideally, for the wake word while locked.
- If iOS suspends microphone capture, the app should recover automatically when the system permits it and restore recent conversational context.

## Native iOS architecture
The native iPhone app is the preferred voice shell for ZYRON.

- `AVAudioSession` configured for two-way voice (`playAndRecord`) and appropriate background audio behavior.
- Local wake-word detector runs on-device to minimize battery, privacy exposure, latency and API cost.
- Only after a valid invocation should audio be sent to OpenAI Realtime.
- Existing ZYRON backend remains the source of private/current tools such as Calendar, Gmail, tasks, briefing, Google Routes, Google Places, memory and system state.
- OpenAI secrets remain server-side. The native app must use short-lived/ephemeral session credentials rather than embedding the permanent API key.

## Privacy and battery principles
- Do not continuously upload ambient microphone audio merely to detect the wake word.
- Make microphone activity visible in the ways required by iOS.
- Keep local wake-word processing lightweight.
- Stop cloud audio streaming as soon as the active interaction ends.

## Known iOS constraint
A third-party iOS app cannot assume it will be allowed to run arbitrary microphone processing forever in every state. iOS may suspend or terminate apps, especially after force-quit, reboot or under system resource pressure. The implementation should aim for the closest reliable behavior permitted by iOS, with automatic recovery and Siri/App Intents as a fallback entry path when the native listener is unavailable.
