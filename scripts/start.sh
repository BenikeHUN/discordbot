#!/bin/sh
# Panels like Pterodactyl exec the startup command directly, with no shell
# around it, so everything that has to happen before the bot starts lives here.
set -e

cd "$(dirname "$0")/.." || exit 1

if [ ! -d node_modules ]; then
  echo "node_modules is missing, installing dependencies first."
  npm install --no-audit --no-fund
fi

exec node src/index.js
