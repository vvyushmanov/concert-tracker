#!/usr/bin/env python3
"""
Migration script to normalize cities in existing database
Adds normalizedCity field to all existing concerts
"""

import sys
import argparse
sys.path.insert(0, 'concert-tracker/scripts')
from db_models import Concert, get_session, create_database
from city_normalizer import CityNormalizer


def migrate_cities(db_path: str, dry_run: bool = False, force: bool = False):
    """Migrate existing concerts to add normalized city names
    
    Args:
        db_path: Path to SQLite database
        dry_run: If True, don't commit changes
        force: If True, re-normalize even if normalizedCity already exists
    """
    print(f"Starting city normalization migration...")
    print(f"Database: {db_path}")
    print(f"Dry run: {dry_run}")
    print()
    
    # Create tables if they don't exist (adds CityMapping table)
    create_database(db_path)
    
    # Get database session
    session = get_session(db_path)
    normalizer = CityNormalizer(session)
    
    if force:
        print("Force mode: Re-normalizing all concerts")
    
    try:
        # Get all concerts
        concerts = session.query(Concert).all()
        total = len(concerts)
        
        print(f"Found {total} concerts to process")
        print()
        
        # Track statistics
        stats = {
            'processed': 0,
            'updated': 0,
            'skipped': 0,
            'errors': 0
        }
        
        # Process each concert
        for i, concert in enumerate(concerts, 1):
            try:
                # Check if already has normalized city (skip unless force mode)
                if not force and hasattr(concert, 'normalizedCity') and concert.normalizedCity:
                    stats['skipped'] += 1
                    continue
                
                # Normalize city
                normalized = normalizer.normalize(concert.city, concert.country)
                
                # Update concert
                concert.normalizedCity = normalized
                stats['updated'] += 1
                stats['processed'] += 1
                
                # Print progress every 50 concerts
                if i % 50 == 0:
                    print(f"Progress: {i}/{total} ({i*100//total}%)")
                
            except Exception as e:
                print(f"Error processing concert {concert.id} ({concert.city}, {concert.country}): {e}")
                stats['errors'] += 1
                continue
        
        # Commit changes
        if not dry_run:
            session.commit()
            print("\nChanges committed to database")
        else:
            session.rollback()
            print("\nDry run - no changes committed")
        
        # Print statistics
        print(f"\n{'='*80}")
        print("MIGRATION STATISTICS")
        print(f"{'='*80}")
        print(f"Total concerts: {total}")
        print(f"Processed: {stats['processed']}")
        print(f"Updated: {stats['updated']}")
        print(f"Skipped (already normalized): {stats['skipped']}")
        if stats['errors'] > 0:
            print(f"Errors: {stats['errors']}")
        print(f"{'='*80}\n")
        
    except Exception as e:
        print(f"Migration failed: {e}")
        session.rollback()
        sys.exit(1)
    finally:
        session.close()


def add_manual_mappings(db_path: str):
    """Add some common manual mappings for known metropolitan areas
    
    Args:
        db_path: Path to SQLite database
    """
    print("Adding manual city mappings...")
    
    session = get_session(db_path)
    normalizer = CityNormalizer(session)
    
    # Common metropolitan area mappings
    mappings = [
        # Lyon agglomeration (France)
        ('Lyon (Décines-Charpieu)', 'France', 'Lyon'),
        ('Décines-Charpieu', 'France', 'Lyon'),
        ('Villeurbanne', 'France', 'Lyon'),
        
        # Paris agglomeration (France)
        ('Saint-Denis', 'France', 'Paris'),
        ('Montreuil', 'France', 'Paris'),
        ('Clichy', 'France', 'Paris'),
        
        # London agglomeration (UK)
        ('Camden', 'United Kingdom', 'London'),
        ('Brixton', 'United Kingdom', 'London'),
        ('Islington', 'United Kingdom', 'London'),
        
        # Berlin agglomeration (Germany)
        ('Kreuzberg', 'Germany', 'Berlin'),
        ('Friedrichshain', 'Germany', 'Berlin'),
        
        # Frankfurt agglomeration (Germany)
        ('Wiesbaden', 'Germany', 'Frankfurt'),
        
        # Add more as needed...
    ]
    
    added = 0
    for original, country, normalized in mappings:
        try:
            normalizer.add_manual_mapping(original, country, normalized)
            added += 1
            print(f"  Added: {original} ({country}) → {normalized}")
        except Exception as e:
            print(f"  Error adding {original}: {e}")
    
    print(f"\nAdded {added} manual mappings")
    session.close()


def main():
    parser = argparse.ArgumentParser(
        description='Migrate existing concerts to add normalized city names'
    )
    parser.add_argument(
        'db_path',
        help='Path to SQLite database file'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run without committing changes'
    )
    parser.add_argument(
        '--add-mappings',
        action='store_true',
        help='Add common manual mappings before migration'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-normalize all concerts even if they already have normalizedCity'
    )
    
    args = parser.parse_args()
    
    # Add manual mappings if requested
    if args.add_mappings:
        add_manual_mappings(args.db_path)
        print()
    
    # Run migration
    migrate_cities(args.db_path, args.dry_run, args.force)


if __name__ == '__main__':
    main()
