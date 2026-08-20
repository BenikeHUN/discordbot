#!/bin/sh
# Panels like Pterodactyl exec the startup command directly, with no shell
# around it, so everything that has to happen before the bot starts lives here.
set -e

cd "$(dirname "$0")/.." || exit 1

install_deps() {
  echo "Installing dependencies, this takes a minute on a fresh server."
  npm install
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
fi

exec node src/index.js
