#!/usr/bin/env python3
"""
Add normalizedCity column to Concert table
"""

import sqlite3
import sys


def add_normalized_city_column(db_path: str):
    """Add normalizedCity column to Concert table if it doesn't exist
    
    Args:
        db_path: Path to SQLite database
    """
    print(f"Adding normalizedCity column to database: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check if column already exists
        cursor.execute("PRAGMA table_info(Concert)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'normalizedCity' in columns:
            print("Column 'normalizedCity' already exists")
            return
        
        # Add the column with a default value (empty string for now)
        print("Adding column 'normalizedCity'...")
        cursor.execute("""
            ALTER TABLE Concert 
            ADD COLUMN normalizedCity TEXT NOT NULL DEFAULT ''
        """)
        
        # Create index on normalizedCity
        print("Creating index on normalizedCity...")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_concert_normalized_city 
            ON Concert(normalizedCity)
        """)
        
        conn.commit()
        print("✓ Column added successfully")
        
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()


def create_city_mapping_table(db_path: str):
    """Create CityMapping table if it doesn't exist
    
    Args:
        db_path: Path to SQLite database
    """
    print(f"Creating CityMapping table in database: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Create CityMapping table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS CityMapping (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                originalCity TEXT NOT NULL,
                country TEXT NOT NULL,
                normalizedCity TEXT NOT NULL,
                latitude TEXT,
                longitude TEXT,
                source TEXT NOT NULL,
                createdAt INTEGER NOT NULL,
                updatedAt INTEGER NOT NULL,
                UNIQUE(originalCity, country)
            )
        """)
        
        # Create indexes
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_city_mapping_normalized 
            ON CityMapping(normalizedCity, country)
        """)
        
        conn.commit()
        print("✓ CityMapping table created successfully")
        
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python add_normalized_city_column.py <db_path>")
        sys.exit(1)
    
    db_path = sys.argv[1]
    
    create_city_mapping_table(db_path)
    add_normalized_city_column(db_path)
    
    print("\n✓ Database schema updated successfully")
