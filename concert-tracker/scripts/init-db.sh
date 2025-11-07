#!/bin/bash
# Grant necessary privileges to MySQL user for Prisma Migrate and custom migrations

set -e

echo "Granting privileges to user: $MYSQL_USER"

mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
    -- Grant database-level privileges for Prisma Migrate
    -- CREATE, DROP, ALTER, INDEX, REFERENCES are needed for migrations
    GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO '$MYSQL_USER'@'%';
    
    -- Grant ALL privileges on main database with GRANT OPTION
    GRANT ALL PRIVILEGES ON concerts.* TO '$MYSQL_USER'@'%' WITH GRANT OPTION;
    
    -- Grant SELECT on mysql system tables (needed for Prisma migrations)
    GRANT SELECT ON mysql.* TO '$MYSQL_USER'@'%';
    
    -- Grant privileges on backup and shadow databases
    GRANT ALL PRIVILEGES ON \`concerts-backup\`.* TO '$MYSQL_USER'@'%';
    GRANT ALL PRIVILEGES ON \`concerts_shadow\`.* TO '$MYSQL_USER'@'%';
    
    FLUSH PRIVILEGES;
    
    -- Show granted privileges
    SHOW GRANTS FOR '$MYSQL_USER'@'%';
EOSQL

echo "Privileges granted successfully!"
