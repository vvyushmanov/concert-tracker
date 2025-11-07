# Database Deployment Guide

## Automated Deployment (Recommended)

### For Fresh Database
When deploying against an empty database, the system automatically:

1. **MySQL initialization** (`init-db.sh`)
   - Grants necessary privileges to `concertuser`
   - Runs automatically via Docker entrypoint on first startup
   
2. **Schema & migrations** (`startup.sh`)
   - Applies all Prisma migrations via `npx prisma migrate deploy`
   - Includes collation fix and all schema changes
   - Runs automatically when container starts

### Usage

Simply start the containers - migrations apply automatically:

```bash
# Start containers (migrations run automatically)
docker compose up -d
```

That's it! The `startup.sh` script handles everything.

## What Gets Applied

### 1. Database Permissions (`init-db.sh`)
Automatically grants on container startup:
- `CREATE` on `*.*` (for Prisma shadow database)
- `ALL PRIVILEGES` on `concerts.*` with `GRANT OPTION`
- `SELECT` on `mysql.*` (for Prisma migrations)
- `ALL PRIVILEGES` on backup/shadow databases

### 2. Prisma Migrations (`npx prisma migrate deploy`)
Applies all migrations in order:

**Migration 1: Baseline** (`0_init`)
- Creates all tables, indexes, and constraints from `prisma/schema.prisma`

**Migration 2: Collation Fix** (`20251107175454_fix_citymapping_collation`)
```sql
ALTER TABLE `CityMapping` 
  MODIFY COLUMN `originalCity` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL;
```

This ensures cities with diacritics are treated as distinct:
- "Düsseldorf" ≠ "Dusseldorf"
- "İstanbul" ≠ "Istanbul"

## Manual Deployment

If you need to apply migrations manually:

### Step 1: Grant Permissions
```bash
docker compose exec db mysql -u root -p'${MYSQL_ROOT_PASSWORD}' <<EOF
GRANT CREATE ON *.* TO 'concertuser'@'%';
GRANT ALL PRIVILEGES ON concerts.* TO 'concertuser'@'%' WITH GRANT OPTION;
GRANT SELECT ON mysql.* TO 'concertuser'@'%';
FLUSH PRIVILEGES;
EOF
```

### Step 2: Apply Schema
```bash
docker compose exec web npx prisma db push
```

### Step 3: Apply Collation Fix
```bash
docker compose exec db mysql -u concertuser -p'${MYSQL_PASSWORD}' concerts < concert-tracker/prisma/migrations/fix_citymapping_collation.sql
```

## Verification

Check that collation was applied:
```bash
docker compose exec db mysql -u root -p'${MYSQL_ROOT_PASSWORD}' concerts -e "
SELECT COLUMN_NAME, COLLATION_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'CityMapping' 
  AND COLUMN_NAME IN ('originalCity', 'normalizedCity');
"
```

Expected output:
```
+----------------+--------------------+
| COLUMN_NAME    | COLLATION_NAME     |
+----------------+--------------------+
| originalCity   | utf8mb4_bin        |
| normalizedCity | utf8mb4_unicode_ci |
+----------------+--------------------+
```

## CI/CD Integration

Add to your deployment pipeline:

```yaml
# Example GitHub Actions
- name: Deploy Database
  run: |
    docker compose up -d db
    docker compose exec -T web bash -c "cd /app && ./scripts/deploy-db.sh"
```

## Troubleshooting

### "User denied access" error
- Ensure `init-db.sh` ran successfully
- Check grants: `SHOW GRANTS FOR 'concertuser'@'%';`
- Manually grant permissions (see Manual Deployment)

### Collation not applied
- Run `deploy-db.sh` again
- Check current collation with verification query above
- Manually apply SQL from `prisma/migrations/fix_citymapping_collation.sql`

### Prisma migrations failing
- Ensure user has `CREATE` privilege on `*.*`
- Ensure user has `SELECT` on `mysql.*`
- Check Docker logs: `docker compose logs db`

## Why Not Change Prisma Schema?
Prisma doesn't support specifying collation in the schema file. Collation is a database-level concern managed through:
- Prisma migrations with raw SQL (applied automatically)
- Database configuration
- Documentation in code comments

## Files

- `concert-tracker/scripts/init-db.sh` - Grants permissions on DB startup
- `concert-tracker/scripts/startup.sh` - Applies migrations on container start
- `prisma/migrations/0_init/` - Baseline schema migration
- `prisma/migrations/20251107175454_fix_citymapping_collation/` - Collation fix migration
- `prisma/migrations/README_COLLATION.md` - Detailed collation documentation
