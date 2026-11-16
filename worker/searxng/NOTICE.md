# SearXNG container

Pinned image: docker.io/searxng/searxng:2026.11.15-2d500cb6b@sha256:932f69dca010db9880bddebb2171f05d8e1a25d04a59149ff65409993d680024.

Verified 2026-11-16 from [Docker Hub tag metadata](https://hub.docker.com/v2/repositories/searxng/searxng/tags/2026.11.15-2d500cb6b). This is the multi-platform manifest digest; linux/amd64 digest is sha256:d8645d64b8d71bab51e97cf3a3bfd90499618dd64290bf3532c0236f0001a008. No image was downloaded or started.

SearXNG is AGPL-3.0-or-later; source and image metadata: [pinned Dockerfile](https://github.com/searxng/searxng/blob/2d500cb6b/container/Dockerfile). No source is vendored or changed. Keep upstream notices; review licence obligations before offering this service publicly.

Configuration uses documented [keep_only](https://docs.searxng.org/admin/settings/settings.html#use-default-settings) and [SEARXNG_SECRET override](https://docs.searxng.org/admin/settings/settings_server.html). The secret is required from the VPS environment, never stored here. Limiter is disabled because the secret-guarded wrapper enforces the shared limit. Only the six approved engines load.

Capabilities: none added. The pinned image owns its application as UID/GID 977. Compose explicitly runs 977:977 with cap_drop ALL, no-new-privileges and FORCE_OWNERSHIP=false. Its [entrypoint](https://github.com/searxng/searxng/blob/2d500cb6b/container/entrypoint.sh) performs ownership/certificate writes only as root; non-root startup avoids those operations. Read-only config and a UID-977 cache tmpfs replace ownership-changing mounts. Runtime compatibility remains unverified until authorized rollout.

Only wrapper and SearXNG join internal search-link. SearXNG also needs search-egress to reach public engines; an internal-only network cannot perform web searches. No host ports are published. Existing n8n, Postiz, Reacher, scraper and tunnel settings are unchanged. Container resource limits are 512 MiB and 0.5 CPU.
