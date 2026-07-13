#!/usr/bin/env bash

# Cut a release: bump the @symfony/reprise version, commit, and tag it.
#
# Usage: ./release.sh <patch|minor|major|x.y.z>
#
# It only prepares the commit and tag locally. Pushing the tag is left to you,
# because that is what triggers the production publish (see MAINTAINERS.md).

set -euo pipefail

bump="${1:-}"
if [ -z "$bump" ]; then
    echo "Usage: $0 <patch|minor|major|x.y.z>" >&2
    exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
    echo "Error: releases are cut from 'main', but you are on '$branch'." >&2
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Error: the working tree is not clean. Commit or stash your changes first." >&2
    exit 1
fi

git fetch --quiet upstream main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
    echo "Error: local 'main' is not in sync with 'upstream/main'. Pull first." >&2
    exit 1
fi

# Run pnpm version inside assets/, the publishable package: from the repo root it would target the
# private root package, and with --filter pnpm skips the commit and tag. This bumps
# assets/package.json, commits the change, and creates the matching vX.Y.Z tag.
(cd assets && pnpm version "$bump")

version="$(node -p "require('./assets/package.json').version")"
tag="v${version}"

echo
echo "Prepared ${tag}. Review the commit and tag, then publish with:"
echo
echo "    git push upstream main --follow-tags"
echo
echo "Pushing ${tag} triggers the Release on NPM workflow, which publishes to npm."
