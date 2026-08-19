#!/bin/sh
# Startup script for concert-tracker (MySQL only).
# Generates the Prisma client, waits for the DB, applies migrations, seeds, and
# starts the dev server. prisma/schema.prisma is the single source of truth.

set -e

echo "=========================================="
echo "Concert Tracker Startup"
echo "=========================================="
cd /app

# 1. Install npm dependencies
echo ""
echo "Step 1: Installing npm dependencies..."
npm install

# 2. Generate Prisma client
echo ""
echo "Step 2: Generating Prisma client..."
npx prisma generate

# 3. Wait for the MySQL database to be ready
echo ""
echo "Step 3: Waiting for database connection..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if echo "SELECT 1;" | npx prisma db execute --stdin 2>/dev/null; then
        echo "✓ Database connection successful!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Waiting for database... (attempt $attempt/$max_attempts)"
    sleep 2
done
if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: Could not connect to database after $max_attempts attempts"
    exit 1
fi

# 4. Apply database migrations
echo ""
echo "Step 4: Applying database migrations..."
if npx prisma migrate deploy; then
    echo "✓ All migrations applied successfully"
else
    echo "⚠️  Migration failed. Check logs above."
    exit 1
fi

# 5. Seed database (create default admin if needed)
echo ""
echo "Step 5: Seeding database..."
if npx prisma db seed; then
    echo "✓ Database seeding complete"
else
    echo "⚠️  Seeding failed, but continuing startup..."
fi

echo ""
echo "=========================================="
echo "✓ Startup complete! Starting dev server..."
echo "=========================================="
echo ""

# 6. Start the development server
exec npm run dev
