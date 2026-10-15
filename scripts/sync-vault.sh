#!/usr/bin/env bash
# Copies this project's markdown (rules, specs, plans, to-do) into the Obsidian vault so every agent sees the same context.
# One-way: repo -> vault/Dreamlabs Sales/Repo. Agent notes (Status, Decisions, Log) live in the vault and are NOT touched.
# Override the vault with VAULT="/path/to/vault". Runs automatically from .git/hooks/post-commit (see AGENTS.md).
set -u
VAULT="${VAULT:-/c/Users/kevin/OneDrive/Desktop/DI Dreamlabs Context Brain}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$VAULT/Dreamlabs Sales/Repo"
[ -d "$VAULT/.obsidian" ] || { echo "sync-vault: vault not found at $VAULT (skipped)"; exit 0; }
mkdir -p "$DEST/docs/superpowers/specs" "$DEST/docs/superpowers/plans"
for f in AGENTS.md CLAUDE.md SPEC.md; do [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$DEST/$f"; done
for f in "$ROOT"/docs/*.md; do [ -f "$f" ] && cp -f "$f" "$DEST/docs/"; done
for f in "$ROOT"/docs/superpowers/specs/*.md; do [ -f "$f" ] && cp -f "$f" "$DEST/docs/superpowers/specs/"; done
for f in "$ROOT"/docs/superpowers/plans/*.md; do [ -f "$f" ] && cp -f "$f" "$DEST/docs/superpowers/plans/"; done
echo "sync-vault: copied to $DEST"
