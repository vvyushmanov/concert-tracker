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

# 5. Apply database schema
echo ""
echo "Step 5: Setting up database schema..."

# Check if database tables already exist
echo "Checking if database schema exists..."
if npx prisma db execute --stdin <<EOF 2>/dev/null
SELECT 1 FROM Artist LIMIT 1;
EOF
then
    echo "✓ Database schema already exists, skipping schema setup"
    echo "  (If you need to update schema, run: npx prisma db push)"
else
    echo "Database schema not found, creating initial schema..."
    # Use db push without --accept-data-loss for safety
    # This will fail if there's a destructive change, which is what we want
    if npx prisma db push --skip-generate 2>/dev/null; then
        echo "✓ Database schema created successfully"
    else
        echo "⚠️  Schema push failed. You may need to run migrations manually."
        echo "  Try: npx prisma migrate dev"
    fi
fi

echo ""
echo "=========================================="
echo "✓ Startup complete! Starting dev server..."
echo "=========================================="
echo ""

# 6. Start the development server
exec npm run dev
