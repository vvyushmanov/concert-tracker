#!/bin/bash
# Grant necessary privileges to MySQL user for Prisma Migrate and custom migrations

set -ex

echo "Granting privileges to user: $MYSQL_USER for database: $MYSQL_DATABASE"

mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
    -- Create database if it doesn't exist
    CREATE DATABASE IF NOT EXISTS \`$MYSQL_DATABASE\`;

    -- Grant database-level privileges for Prisma Migrate
    -- CREATE, DROP, ALTER, INDEX, REFERENCES are needed for migrations
    GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO '$MYSQL_USER'@'%';

    -- Grant ALL privileges on main database with GRANT OPTION (use env var for database name)
    GRANT ALL PRIVILEGES ON \`$MYSQL_DATABASE\`.* TO '$MYSQL_USER'@'%' WITH GRANT OPTION;

    -- Grant SELECT on mysql system tables (needed for Prisma migrations)
    GRANT SELECT ON mysql.* TO '$MYSQL_USER'@'%';

    -- Grant privileges on backup and shadow databases (dynamic names based on MYSQL_DATABASE)
    GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}-backup\`.* TO '$MYSQL_USER'@'%';
    GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_shadow\`.* TO '$MYSQL_USER'@'%';

    FLUSH PRIVILEGES;

    -- Show granted privileges
    SHOW GRANTS FOR '$MYSQL_USER'@'%';
EOSQL

echo "Privileges granted successfully for database: $MYSQL_DATABASE"
