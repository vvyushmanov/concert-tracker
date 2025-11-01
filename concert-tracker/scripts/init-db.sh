#!/bin/bash
# Grant CREATE privilege to MySQL user for Prisma Migrate shadow database

set -e

echo "Granting CREATE privilege to user: $MYSQL_USER"

mysql -u root -p"$MYSQL_ROOT_PASSWORD" <<-EOSQL
    GRANT CREATE ON *.* TO '$MYSQL_USER'@'%';
    FLUSH PRIVILEGES;
    SELECT User, Host, Create_priv FROM mysql.user WHERE User='$MYSQL_USER';
EOSQL

echo "Privileges granted successfully!"
