#!/bin/sh
# Panels like Pterodactyl exec the startup command directly, with no shell
# around it, so everything that has to happen before the bot starts lives here.
set -e

cd "$(dirname "$0")/.." || exit 1

# The native Opus build leaves its object files and the bundled libopus sources
# in place, around fifty megabytes that nothing reads once the binary exists.
# Cheap and harmless to repeat, so it also reclaims the space on servers that
# were installed before this existed.
prune_build_leftovers() {
  rm -rf node_modules/@discordjs/opus/build-tmp-napi-v3 \
         node_modules/@discordjs/opus/deps \
         node_modules/@discordjs/opus/src \
         node_modules/@discordjs/opus/tests
}

install_deps() {
  echo "Installing dependencies, this takes a minute on a fresh server."
  npm install
  prune_build_leftovers
  # The download cache survives every reinstall and grows without limit, which
  # on a panel is the user's disk quota filling up for no benefit.
  npm cache clean --force >/dev/null 2>&1 || true
  echo "Dependencies installed."
}

if [ ! -d node_modules ]; then
  install_deps
elif ! node --input-type=module -e "await import('@discordjs/voice')" >/dev/null 2>&1; then
  # Several dependencies ship a native binding chosen by platform and libc, so
  # a tree installed under a different container image cannot load here.
  echo "Dependencies were built for a different platform, reinstalling."
  rm -rf node_modules
  install_deps
else
  prune_build_leftovers
fi

exec node src/index.js
