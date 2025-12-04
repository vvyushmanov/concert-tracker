#!/bin/sh
# Comprehensive startup script for concert-tracker
# Handles database switching, schema setup, and application startup

set -e

echo "=========================================="
echo "Concert Tracker Startup"
echo "=========================================="

# 1. Switch database schema based on DB_TYPE
echo ""
echo "Step 1: Switching database schema..."
cd /app
sh scripts/switch_db.sh

# 2. Install npm dependencies
echo ""
echo "Step 2: Installing npm dependencies..."
npm install

# 3. Generate Prisma client
echo ""
echo "Step 3: Generating Prisma client..."
npx prisma generate

# 4. Wait for database to be fully ready (only for MySQL)
echo ""
echo "Step 4: Checking database connection..."

# Check if we're using MySQL (not SQLite)
if [ "$DB_TYPE" = "mysql" ]; then
    echo "MySQL detected - waiting for connection..."
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
else
    echo "✓ SQLite detected - no connection wait needed"
fi

# 5. Apply database migrations
echo ""
echo "Step 5: Applying database migrations..."

# Check if _prisma_migrations table exists (indicates migrations are being used)
echo "Checking migration status..."
if npx prisma db execute --stdin <<EOF 2>/dev/null
SELECT 1 FROM _prisma_migrations LIMIT 1;
EOF
then
    echo "✓ Migration system detected, applying pending migrations..."
    # Apply all pending migrations (includes collation fix)
    if npx prisma migrate deploy; then
        echo "✓ All migrations applied successfully"
    else
        echo "⚠️  Migration failed. Check logs above."
        exit 1
    fi
else
    echo "Migration history not found. This appears to be a fresh database."
    echo "Applying all migrations from scratch..."
    # For fresh database, migrate deploy will apply all migrations
    if npx prisma migrate deploy; then
        echo "✓ Database initialized with all migrations"
    else
        echo "⚠️  Migration failed. You may need to initialize manually."
        echo "  Try: npx prisma migrate dev"
        exit 1
    fi
fi

# 6. Seed database (create default admin if needed)
echo ""
echo "Step 6: Seeding database..."
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

# 7. Start the development server
exec npm run dev
