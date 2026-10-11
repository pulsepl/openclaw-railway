# Hardened build:
# - Installs the official, prebuilt OpenClaw npm package (its direct dependencies are
#   pinned to exact versions) instead of compiling from source. The source build of
#   current OpenClaw needs ~4.7 GB RAM and floated dependency versions.
# - Node 24 (current OpenClaw requires >=24.16).
# - Runs as an unprivileged "openclaw" user (see scripts/entrypoint.sh).
#
# To upgrade OpenClaw, change OPENCLAW_VERSION below (or set it as a Railway variable)
# and redeploy. Use a version that has been published for at least a few days.

FROM node:24-bookworm AS openclaw-install

ARG OPENCLAW_VERSION=2026.10.1

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g --prefix /opt/openclaw --no-fund --no-audit "openclaw@${OPENCLAW_VERSION}" \
  && npm cache clean --force \
  && test -f /opt/openclaw/lib/node_modules/openclaw/dist/entry.js


# Runtime image
FROM node:24-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    git \
    python3 \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Unprivileged runtime user.
RUN groupadd --system --gid 10001 openclaw \
  && useradd --system --uid 10001 --gid openclaw --create-home --home-dir /home/openclaw \
    --shell /usr/sbin/nologin openclaw

COPY --from=openclaw-install /opt/openclaw /opt/openclaw
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /opt/openclaw/lib/node_modules/openclaw/openclaw.mjs "$@"' > /usr/local/bin/openclaw \
  && chmod 0755 /usr/local/bin/openclaw

# The wrapper launches OpenClaw through this entry file.
ENV OPENCLAW_ENTRY=/opt/openclaw/lib/node_modules/openclaw/dist/entry.js

# Persist user-installed tools by default by targeting the Railway volume.
ENV NPM_CONFIG_PREFIX=/data/npm
ENV NPM_CONFIG_CACHE=/data/npm-cache
ENV PNPM_HOME=/data/pnpm
ENV PNPM_STORE_DIR=/data/pnpm-store
ENV PATH="/data/npm/bin:/data/pnpm:${PATH}"

WORKDIR /app

# Wrapper deps (locked)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force

COPY src ./src
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

# The wrapper listens on $PORT.
# IMPORTANT: Do not set a default PORT here.
# Railway injects PORT at runtime and routes traffic to that port.
EXPOSE 8080

# tini reaps zombies and forwards signals; entrypoint.sh fixes /data ownership and
# drops root before starting the wrapper.
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/server.js"]
