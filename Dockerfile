# Debian rather than Alpine on purpose: @discordjs/opus resolves a prebuilt
# glibc binary there, and ffmpeg-static only publishes glibc builds.
FROM node:24-bookworm-slim AS deps

# python3, make and g++ are only needed if node-pre-gyp cannot find a prebuilt
# opus binary for this Node version and has to compile it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The postinstall hook reads src/config.js to locate yt-dlp, so those come in
# before the install runs.
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm ci --omit=dev


FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# The yt-dlp binary the install step fetched for this platform.
COPY --from=deps --chown=node:node /app/bin ./bin
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# node owns bin/ so yt-dlp can replace its own binary at runtime.
USER node

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
