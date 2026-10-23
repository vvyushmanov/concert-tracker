# Production Dockerfile for Next.js concert tracker
# Multi-stage build; only the slim runner stage ships. Build cache is pruned
# after each build by deploy.sh, so nothing from the build stages lingers.

# Alpine 3.23 pinned: it is the last release with Python 3.12 (the scripts'
# target) and its nodejs package tracks Node 24 LTS
ARG ALPINE=3.23

# Stage 1: Builder
FROM node:24-alpine${ALPINE} AS builder
WORKDIR /app

# Install Prisma dependencies
RUN apk add --no-cache openssl

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --no-audit --no-fund

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY . .

# Create public directory if it doesn't exist
RUN mkdir -p public

# Build Next.js application, and the seed to plain JS so the runner needs no tsx
RUN npm run build \
    && npx esbuild prisma/seed.ts --bundle --platform=node --external:@prisma/client \
       --outfile=prisma/seed.js --log-level=warning

# Stage 2: Prisma CLI for `migrate deploy` at container start (~30 MB, vs the
# full builder node_modules). Its query engine duplicates the app's, so drop it.
FROM node:24-alpine${ALPINE} AS prisma-cli
WORKDIR /opt/prisma
RUN apk add --no-cache openssl
# Exact locked version: the runner symlinks this CLI to the app's query engine
COPY package-lock.json /tmp/package-lock.json
RUN PRISMA_VERSION=$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version") \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
    && rm -f node_modules/@prisma/engines/libquery_engine-* \
    && rm -rf node_modules/prisma/build/public

# Stage 3: Runner — plain Alpine + its nodejs package (shared system libs:
# ~80 MB smaller than the official node image, and no npm/yarn/corepack).
FROM alpine:${ALPINE} AS runner
WORKDIR /app

# Python deps first (rarely change): build-only pip lives in a virtual package
# that is removed in the same layer, so the image carries no pip/setuptools.
# Also dropped: greenlet (SQLAlchemy only needs it for asyncio, unused here)
# and stdlib parts nothing imports at runtime.
COPY scripts/requirements.txt /tmp/requirements.txt
RUN apk add --no-cache nodejs openssl ca-certificates python3~=3.12 \
    && apk add --no-cache --virtual .pip py3-pip \
    && pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt \
    && pip3 uninstall -y --break-system-packages greenlet \
    && apk del .pip \
    && rm -rf /tmp/requirements.txt /root/.cache \
    && cd /usr/lib/python3.12 \
    && rm -rf ensurepip lib2to3 pydoc_data turtledemo site-packages/sqlalchemy/testing \
    && find . -type d -name tests -prune -exec rm -rf {} + \
    && cd / \
    && update-ca-certificates

# Add Comodo AAA root certificate (required for Cloudflare certificate chain)
# This certificate was removed from Alpine's ca-certificates in recent versions
# See: https://gitlab.alpinelinux.org/alpine/aports/-/issues/17445
# Certificate valid until: Dec 31, 2028
RUN printf '%s\n' \
    '-----BEGIN CERTIFICATE-----' \
    'MIIEMjCCAxqgAwIBAgIBATANBgkqhkiG9w0BAQUFADB7MQswCQYDVQQGEwJHQjEb' \
    'MBkGA1UECAwSR3JlYXRlciBNYW5jaGVzdGVyMRAwDgYDVQQHDAdTYWxmb3JkMRow' \
    'GAYDVQQKDBFDb21vZG8gQ0EgTGltaXRlZDEhMB8GA1UEAwwYQUFBIENlcnRpZmlj' \
    'YXRlIFNlcnZpY2VzMB4XDTA0MDEwMTAwMDAwMFoXDTI4MTIzMTIzNTk1OVowezEL' \
    'MAkGA1UEBhMCR0IxGzAZBgNVBAgMEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UE' \
    'BwwHU2FsZm9yZDEaMBgGA1UECgwRQ29tb2RvIENBIExpbWl0ZWQxITAfBgNVBAMM' \
    'GEFBQSBDZXJ0aWZpY2F0ZSBTZXJ2aWNlczCCASIwDQYJKoZIhvcNAQEBBQADggEP' \
    'ADCCAQoCggEBAL5AnfRu4ep2hxxNRUSOvkbIgwadwSr+GB+O5AL686tdUIoWMQua' \
    'BtDFcCLNSS1UY8y2bmhGC1Pqy0wkwLxyTurxFa70VJoSCsN6sjNg4tqJVfMiWPPe' \
    '3M/vg4aijJRPn2jymJBGhCfHdr/jzDUsi14HZGWCwEiwqJH5YZ92IFCokcdmtet4' \
    'YgNW8IoaE+oxox6gmf049vYnMlhvB/VruPsUK6+3qszWY19zjNoFmag4qMsXeDZR' \
    'rOme9Hg6jc8P2ULimAyrL58OAd7vn5lJ8S3frHRNG5i1R8XlKdH5kBjHYpy+g8cm' \
    'ez6KJcfA3Z3mNWgQIJ2P2N7Sw4ScDV7oL8kCAwEAAaOBwDCBvTAdBgNVHQ4EFgQU' \
    'oBEKIz6W8Qfs4q8p74Klf9AwpLQwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQF' \
    'MAMBAf8wewYDVR0fBHQwcjA4oDagNIYyaHR0cDovL2NybC5jb21vZG9jYS5jb20v' \
    'QUFBQ2VydGlmaWNhdGVTZXJ2aWNlcy5jcmwwNqA0oDKGMGh0dHA6Ly9jcmwuY29t' \
    'b2RvLm5ldC9BQUFDZXJ0aWZpY2F0ZVNlcnZpY2VzLmNybDANBgkqhkiG9w0BAQUF' \
    'AAOCAQEACFb8AvCb6P+k+tZ7xkSAzk/ExfYAWMymtrwUSWgEdujm7l3sAg9g1o1Q' \
    'GE8mTgHj5rCl7r+8dFRBv/38ErjHT1r0iWAFf2C3BUrz9vHCv8S5dIa2LX1rzNLz' \
    'Rt0vxuBqw8M0Ayx9lt1awg6nCpnBBYurDC/zXDrPbDdVCYfeU0BsWO/8tqtlbgT2' \
    'G9w84FoVxp7Z8VlIMCFlA2zs6SFz7JsDoeA3raAVGI/6ugLOpyypEBMs1OUIJqsi' \
    'l2D4kF501KKaU73yqWjgom7C12yxow+ev+to51byrvLjKzg6CYG1a4XXvi3tPxq3' \
    'smPi9WIsgtRqAEFQ8TmDn5XpNpaYbg==' \
    '-----END CERTIFICATE-----' \
    > /usr/local/share/ca-certificates/Comodo_AAA_Services_root.crt && \
    update-ca-certificates

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder. The standalone bundle already contains
# node_modules/.prisma (client + query engine) — no separate copy needed.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=prisma-cli /opt/prisma/node_modules /opt/prisma/node_modules
# The CLI insists on its own query engine (and tries to download one at
# runtime); point it at the app's identical engine instead of shipping two
RUN ln -s /app/node_modules/.prisma/client/libquery_engine-*.so.node /opt/prisma/node_modules/@prisma/engines/

# Copy Python scripts (spawned by the API routes from /app/scripts)
COPY --chown=nextjs:nodejs scripts ./scripts

# Create data directory for database and .next cache directory
RUN mkdir -p /app/data /app/.next/cache && chown -R nextjs:nodejs /app/data /app/.next

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Migrate + seed (both idempotent), then hand PID 1 to the server
CMD ["sh", "-c", "node /opt/prisma/node_modules/prisma/build/index.js migrate deploy && node prisma/seed.js && exec node server.js"]
