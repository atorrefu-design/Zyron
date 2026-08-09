# ZYRON — App Access Architecture

## Product principle

Cross-app access is a core capability of ZYRON, not an optional integration layer.

The user should speak to ZYRON about an outcome. ZYRON decides which app, service, website, file, connector or native iOS capability is needed. The user should not have to think in terms of opening apps first.

Example target experience:

- “ZYRON, ¿cuándo juega el equipo?” → consult the best available FCBQ source.
- “ZYRON, analiza la última grabación del entreno.” → locate an authorised recording and process it.
- “ZYRON, abre el chat de X en WhatsApp.” → use the safest supported handoff into WhatsApp.
- “ZYRON, añade esto al calendario.” → execute through the authorised calendar connector/native capability.

## iOS reality

iOS sandboxing means ZYRON cannot silently inspect arbitrary private data belonging to every installed app. We therefore implement an access fabric that chooses the strongest supported route per capability.

## Access levels

1. **Direct authorised access**
   - Native iOS frameworks and user-granted permissions.
   - Official APIs/connectors.
   - Examples: calendar, contacts, location, files selected/authorised by the user.

2. **App Intents / Shortcuts / URL actions**
   - Invoke capabilities another app explicitly exposes to iOS.
   - Use deep links or universal links when supported.

3. **Share/import bridge**
   - Content shared to ZYRON from another app.
   - Files/folders the user authorises for ZYRON.
   - Useful for recordings, documents, images and exported conversations/data.

4. **Web/service adapter**
   - When an app is closed but equivalent authorised information is available on its web service or public/official data source, ZYRON queries that source instead of visually automating the app.
   - FCBQ is a priority candidate for this pattern.

5. **Safe handoff only**
   - For closed apps/data ZYRON cannot read, it can open the relevant app/place and hand control to the user rather than pretending it has access.
   - WhatsApp personal message history is a key example unless Meta/iOS exposes an authorised route for the requested operation.

## Capability registry

Every integration should describe capabilities, not just app names. Each capability records:

- identifier and human purpose;
- access level;
- read/write scope;
- whether explicit user interaction is required;
- whether confirmation is required before writes/destructive actions;
- privacy sensitivity;
- availability/health;
- fallback route.

ZYRON's orchestrator selects a capability based on the requested outcome, permissions, reliability, privacy and user friction.

## Security rules

- Never claim access ZYRON does not actually have.
- Least privilege by default.
- Secrets/tokens stay out of GitHub and are stored in approved secret storage/Keychain.
- Sensitive writes and destructive actions use explicit confirmation where appropriate.
- Access can be revoked per connector/capability.
- Diagnostic logs record capability state/errors but not unnecessary private content.

## Priority integration map

### Tier 1 — core personal assistant
Calendar, reminders/tasks, contacts, location/maps, notifications, files, microphone/audio and share sheet.

### Tier 2 — high-value personal workflows
FCBQ/basketball information, recordings/voice notes, WhatsApp supported handoffs/actions, photos/media, email and browser/web sources.

### Tier 3 — expansion
Other installed apps discovered by supported App Intents, URL schemes, APIs, share extensions or user-authorised files/services.

## Architectural requirement

The cloud core and iPhone companion must expose a common `capability` abstraction so that conversation logic asks for an outcome (for example `basketball.schedule.read`) rather than hard-coding a specific app. This keeps ZYRON independent from individual apps and allows a better connector to replace an older one without changing how the user speaks to ZYRON.

## Long-term target

ZYRON becomes the user's primary interaction layer. Apps remain specialised tools underneath it. Whenever iOS permits it, ZYRON reads or acts directly; whenever it does not, ZYRON uses an authorised alternative or performs a transparent handoff.
