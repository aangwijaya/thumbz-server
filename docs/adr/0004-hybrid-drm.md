# 0004 — Hybrid DRM

**Status:** accepted (2026-10)

## Context
Replays need protection that works across Chrome/Edge/Firefox, Safari and iOS
without paying a DRM vendor for a demo, while leaving a path to real
Widevine/PlayReady/FairPlay.

## Decision
- Package once (shaka-packager + ffmpeg): DASH with CENC for EME browsers and
  HLS with AES-128 for Apple's native player, same content key. Encrypted
  segments sit on the public storage CDN; protection lives in key delivery.
- Content keys are stored sealed (AES-256-GCM under `DRM_MASTER_KEY`, KID as
  authenticated data).
- Playback sessions bound to user + asset (10-minute tokens rotated by a
  heartbeat), at most two concurrent streams per account (Redis), immediate
  revocation when a session ends.
- Key delivery: a W3C ClearKey license server, and an HLS manifest proxy that
  injects session-scoped key URLs for Safari (which cannot send headers).
- Commercial key systems are passed through when their license URLs are
  configured; a provider validates tokens via `POST /drm/authorize`.

## Consequences
- ClearKey releases the key to the browser: it stops casual copying and
  enforces entitlement and device limits, not a determined attacker. That is
  the job of the pluggable commercial CDMs (hardware-backed).
- Live streams are not protected (would need a live packager).
