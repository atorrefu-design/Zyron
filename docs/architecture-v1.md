# ZYRON Architecture v1

## Goal
ZYRON is a personal assistant that must remain usable even when the development Mac is powered off. The Mac is a development tool, not part of the runtime.

## Runtime split

### 1. Cloud core
Runs independently of any phone or desktop app.

Responsibilities:
- authentication and owner isolation
- model/provider abstraction
- memory and preferences
- orchestration and action routing
- web/mobile API
- voice decision endpoint
- notifications and future connectors

Primary runtime: Next.js server routes, deployable to Vercel or another Node-compatible platform.

### 2. iPhone client
The iPhone app is an interface and device capability bridge, not the brain.

Responsibilities:
- voice capture and playback
- wake/runtime coordination where iOS permits it
- Siri/Shortcuts fallback
- notifications
- secure local credentials/tokens
- calling the ZYRON cloud API

The iOS client must be buildable on a modern hosted macOS/Xcode environment so local Mac age does not block releases.

### 3. Web client
Provides a persistent mobile/desktop fallback independent of App Store installation and native build cycles.

Responsibilities:
- authenticated chat/control surface
- status and diagnostics
- configuration and permissions
- manual action invocation

## Hard rule
No core capability may require the user's old Mac to be online.

## Deployment strategy

### Backend/web
- Source of truth: GitHub `main`
- CI: typecheck + production build on GitHub Actions
- Production target: Vercel
- Secrets stored only in deployment environment, never committed

### iOS
- Source lives in the same repository under `ios/`
- Local Xcode can be used for editing only when useful
- Production/test builds should run on a modern macOS/Xcode runner or Apple-compatible cloud CI
- Signing credentials must be handled through CI secrets or App Store Connect integration

## Current repository capabilities
The repository already contains a Next.js backend, a health endpoint, CI, voice orchestration endpoints, and native iOS voice/wake-word work. The next phase is therefore migration to cloud-first deployment, not a rewrite.

## Next milestones
1. Deploy backend/web to a persistent cloud URL.
2. Validate `/api/health` in production.
3. Configure production secrets.
4. Point native client configuration to the production API base URL.
5. Add hosted modern-Xcode build pipeline for the iOS target.
6. Deliver the iPhone build through a supported distribution path.

## Security boundaries
- Never commit API keys, Apple signing secrets, identity documents, or banking credentials.
- Server-side provider keys stay server-side.
- The iPhone receives only scoped tokens/ephemeral credentials where possible.
- Owner-only actions must be authenticated and auditable.
