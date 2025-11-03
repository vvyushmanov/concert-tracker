#!/usr/bin/env python3
"""
Phase 2: Populate Country Table
Extract unique countries from Concert table and populate Country table with name and code
"""

import sys
from datetime import datetime
from sqlalchemy import func
from db_models import Country, Concert, get_session

# Country name to ISO code mapping
# Based on common countries in concerts-metal.com
COUNTRY_NAME_TO_CODE = {
    'Turkey': 'tr',
    'France': 'fr',
    'Germany': 'de',
    'United States': 'us',
    'United Kingdom': 'gb',
    'Spain': 'es',
    'Italy': 'it',
    'Netherlands': 'nl',
    'Belgium': 'be',
    'Switzerland': 'ch',
    'Austria': 'at',
    'Poland': 'pl',
    'Czech Republic': 'cz',
    'Sweden': 'se',
    'Norway': 'no',
    'Denmark': 'dk',
    'Finland': 'fi',
    'Portugal': 'pt',
    'Greece': 'gr',
    'Hungary': 'hu',
    'Romania': 'ro',
    'Bulgaria': 'bg',
    'Croatia': 'hr',
    'Serbia': 'rs',
    'Slovenia': 'si',
    'Slovakia': 'sk',
    'Ireland': 'ie',
    'Luxembourg': 'lu',
    'Canada': 'ca',
    'Mexico': 'mx',
    'Brazil': 'br',
    'Argentina': 'ar',
    'Chile': 'cl',
    'Australia': 'au',
    'New Zealand': 'nz',
    'Japan': 'jp',
    'South Korea': 'kr',
    'China': 'cn',
    'India': 'in',
    'Russia': 'ru',
    'Ukraine': 'ua',
    'Israel': 'il',
    'South Africa': 'za',
}


def populate_countries():
    """Extract unique countries from Concert table and populate Country table"""
    
    print("="*80)
    print("PHASE 2: POPULATE COUNTRY TABLE")
    print("="*80)
    
    session = get_session()
    
    try:
        # Get distinct country names from Concert table
        print("\n1. Querying distinct countries from Concert table...")
        distinct_countries = session.query(Concert.country).distinct().all()
        country_names = [c[0] for c in distinct_countries if c[0]]  # Filter out None/empty
        
        print(f"   Found {len(country_names)} unique countries")
        
        if not country_names:
            print("\n⚠️  No countries found in Concert table. Nothing to migrate.")
            return
        
        # Display found countries
        print("\n2. Countries found:")
        for name in sorted(country_names):
            code = COUNTRY_NAME_TO_CODE.get(name, 'xx')
            status = "✓" if code != 'xx' else "⚠"
            print(f"   {status} {name} -> {code}")
        
        # Check for unknown countries
        unknown_countries = [name for name in country_names if name not in COUNTRY_NAME_TO_CODE]
        if unknown_countries:
            print(f"\n⚠️  WARNING: {len(unknown_countries)} countries without code mapping:")
            for name in unknown_countries:
                print(f"   - {name} (will use 'xx' as code)")
            print("\n   You may want to add these to COUNTRY_NAME_TO_CODE in the script.")
        
        # Insert countries into Country table
        print("\n3. Inserting countries into Country table...")
        now = int(datetime.utcnow().timestamp())
        inserted = 0
        skipped = 0
        
        for country_name in country_names:
            # Check if country already exists
            existing = session.query(Country).filter_by(name=country_name).first()
            if existing:
                print(f"   ⊘ Skipped: {country_name} (already exists with code '{existing.code}')")
                skipped += 1
                continue
            
            # Get country code
            country_code = COUNTRY_NAME_TO_CODE.get(country_name, 'xx')
            
            # Check if code already exists (duplicate code)
            existing_code = session.query(Country).filter_by(code=country_code).first()
            if existing_code and country_code != 'xx':
                print(f"   ⚠️  WARNING: Code '{country_code}' already used by '{existing_code.name}'")
                print(f"      Using '{country_code}_{inserted}' for '{country_name}'")
                country_code = f"{country_code}_{inserted}"
            
            # Create new country
            country = Country(
                name=country_name,
                code=country_code,
                createdAt=now,
                updatedAt=now
            )
            session.add(country)
            inserted += 1
            print(f"   ✓ Inserted: {country_name} -> {country_code}")
        
        # Commit changes
        session.commit()
        
        print(f"\n4. Summary:")
        print(f"   ✓ Inserted: {inserted} countries")
        print(f"   ⊘ Skipped:  {skipped} countries (already existed)")
        print(f"   Total:      {inserted + skipped} countries")
        
        # Verify
        print("\n5. Verification:")
        total_countries = session.query(Country).count()
        print(f"   Country table now has {total_countries} records")
        
        # Show sample
        print("\n6. Sample countries in database:")
        sample_countries = session.query(Country).limit(10).all()
        for country in sample_countries:
            print(f"   ID {country.id}: {country.name} ({country.code})")
        
        print("\n" + "="*80)
        print("✅ PHASE 2 COMPLETE: Country table populated successfully")
        print("="*80)
        
    except Exception as e:
        session.rollback()
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == '__main__':
    populate_countries()
