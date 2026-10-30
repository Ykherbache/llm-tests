#!/usr/bin/env bash
# Start a local SearXNG for the web_search tool, bound to 127.0.0.1:8888.
# Works with podman (Fedora Asahi) or docker (macOS).
set -euo pipefail

# Pinned by digest; bump deliberately (podman pull docker.io/searxng/searxng:latest, then update).
IMAGE="docker.io/searxng/searxng@sha256:b7118e681e2ef2e63e5d5b6e5d171af61f982f45ae258438fb4ab86ef065ea72"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$HERE/searxng"
PORT="${SEARXNG_PORT:-8888}"

if command -v podman >/dev/null 2>&1; then RT=podman
elif command -v docker >/dev/null 2>&1; then RT=docker
else echo "need podman or docker" >&2; exit 1; fi

# One-time secret, kept out of the template.
if grep -q "__SECRET_KEY__" "$CONF/settings.yml"; then
  key="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i.bak "s/__SECRET_KEY__/$key/" "$CONF/settings.yml" && rm -f "$CONF/settings.yml.bak"
fi

# Mount only settings.yml, read-only: mounting the directory lets the image
# chown it to its container user, and you lose write access to your config.
# :Z relabels the file for SELinux (Fedora); docker on macOS ignores it.
"$RT" run -d --replace --name searxng \
  -p "127.0.0.1:${PORT}:8080" \
  -v "$CONF/settings.yml:/etc/searxng/settings.yml:ro,Z" \
  "$IMAGE" >/dev/null 2>&1 || \
"$RT" run -d --name searxng \
  -p "127.0.0.1:${PORT}:8080" \
  -v "$CONF/settings.yml:/etc/searxng/settings.yml:ro,Z" \
  "$IMAGE"

echo "SearXNG starting on http://127.0.0.1:${PORT} (stop with: $RT stop searxng)"
