#!/bin/sh
# Switch Prisma schema based on DB_TYPE environment variable

set -e

# Load .env file if it exists
if [ -f .env ]; then
    set -a
    . .env
    set +a
fi

# Get DB_TYPE from environment, default to mysql
DB_TYPE=${DB_TYPE:-mysql}

# Convert to lowercase
DB_TYPE=$(echo "$DB_TYPE" | tr '[:upper:]' '[:lower:]')

PRISMA_DIR="$(dirname "$0")/../prisma"
SCHEMA_FILE="$PRISMA_DIR/schema.prisma"

echo "Switching to $DB_TYPE database..."

if [ "$DB_TYPE" = "sqlite" ]; then
    cp "$PRISMA_DIR/schema.sqlite.prisma" "$SCHEMA_FILE"
    echo "✓ Switched to SQLite schema"
elif [ "$DB_TYPE" = "mysql" ]; then
    cp "$PRISMA_DIR/schema.mysql.prisma" "$SCHEMA_FILE"
    echo "✓ Switched to MySQL schema"
else
    echo "Error: DB_TYPE must be 'sqlite' or 'mysql', got: $DB_TYPE"
    exit 1
fi

echo "✓ Schema file updated: $SCHEMA_FILE"
echo ""
echo "Next steps:"
echo "  1. Set DATABASE_URL in .env"
echo "  2. Run: npx prisma generate"
echo "  3. Run: npx prisma migrate dev (or prisma db push for quick sync)"
