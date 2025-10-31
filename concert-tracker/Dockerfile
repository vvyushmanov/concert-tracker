# Production Dockerfile for Next.js concert tracker
# Multi-stage build for optimized image size

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install Prisma dependencies
RUN apk add --no-cache openssl

# Copy package files
COPY concert-tracker/package.json concert-tracker/package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Install Prisma dependencies
RUN apk add --no-cache openssl

# Copy package files
COPY concert-tracker/package.json concert-tracker/package-lock.json* ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy Prisma schema
COPY concert-tracker/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy application code
COPY concert-tracker/. .

# Create public directory if it doesn't exist
RUN mkdir -p public

# Build Next.js application
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

# Install runtime dependencies (including Python for rescan)
RUN apk add --no-cache openssl python3 py3-pip

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Copy Python scripts and requirements from project root
COPY --chown=nextjs:nodejs country_concert_parser.py ./scripts/
COPY --chown=nextjs:nodejs concert_utils.py ./scripts/
COPY --chown=nextjs:nodejs db_models.py ./scripts/
COPY --chown=nextjs:nodejs db_writer.py ./scripts/
COPY --chown=nextjs:nodejs proxy_manager.py ./scripts/
COPY --chown=nextjs:nodejs requirements.txt ./scripts/

# Install Python dependencies
RUN pip3 install --no-cache-dir -r ./scripts/requirements.txt --break-system-packages

# Create data directory for database and .next cache directory
RUN mkdir -p /app/data /app/.next/cache && chown -R nextjs:nodejs /app/data /app/.next

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
