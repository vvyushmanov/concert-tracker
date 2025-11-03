#!/usr/bin/env python3
"""
Phase 4: Populate Foreign Keys
Link existing Concert and CityMapping records to Country table via countryId
"""

import sys
from db_models import Country, Concert, CityMapping, get_session


def populate_foreign_keys():
    """Set countryId values based on existing country strings"""
    
    print("="*80)
    print("PHASE 4: POPULATE FOREIGN KEYS")
    print("="*80)
    
    session = get_session()
    
    try:
        # Get all countries for lookup
        print("\n1. Loading countries from Country table...")
        countries = session.query(Country).all()
        country_map = {c.name: c.id for c in countries}
        print(f"   Loaded {len(countries)} countries")
        
        # Update Concert table
        print("\n2. Updating Concert.countryId...")
        concerts = session.query(Concert).all()
        updated_concerts = 0
        null_concerts = 0
        not_found_concerts = []
        
        for concert in concerts:
            if not concert.country:
                null_concerts += 1
                continue
            
            country_id = country_map.get(concert.country)
            if country_id:
                concert.countryId = country_id
                updated_concerts += 1
            else:
                not_found_concerts.append(concert.country)
        
        print(f"   ✓ Updated: {updated_concerts} concerts")
        if null_concerts > 0:
            print(f"   ⊘ Skipped: {null_concerts} concerts (NULL country)")
        if not_found_concerts:
            print(f"   ⚠️  WARNING: {len(not_found_concerts)} concerts with unknown countries:")
            for country_name in set(not_found_concerts):
                count = not_found_concerts.count(country_name)
                print(f"      - '{country_name}' ({count} concerts)")
        
        # Update CityMapping table
        print("\n3. Updating CityMapping.countryId...")
        city_mappings = session.query(CityMapping).all()
        updated_mappings = 0
        null_mappings = 0
        not_found_mappings = []
        
        for mapping in city_mappings:
            if not mapping.country:
                null_mappings += 1
                continue
            
            country_id = country_map.get(mapping.country)
            if country_id:
                mapping.countryId = country_id
                updated_mappings += 1
            else:
                not_found_mappings.append(mapping.country)
        
        print(f"   ✓ Updated: {updated_mappings} city mappings")
        if null_mappings > 0:
            print(f"   ⊘ Skipped: {null_mappings} mappings (NULL country)")
        if not_found_mappings:
            print(f"   ⚠️  WARNING: {len(not_found_mappings)} mappings with unknown countries:")
            for country_name in set(not_found_mappings):
                count = not_found_mappings.count(country_name)
                print(f"      - '{country_name}' ({count} mappings)")
        
        # Commit changes
        print("\n4. Committing changes...")
        session.commit()
        print("   ✓ Changes committed successfully")
        
        # Verification
        print("\n5. Verification:")
        concerts_with_fk = session.query(Concert).filter(Concert.countryId.isnot(None)).count()
        concerts_without_fk = session.query(Concert).filter(Concert.countryId.is_(None)).count()
        mappings_with_fk = session.query(CityMapping).filter(CityMapping.countryId.isnot(None)).count()
        mappings_without_fk = session.query(CityMapping).filter(CityMapping.countryId.is_(None)).count()
        
        print(f"   Concert table:")
        print(f"     - With countryId:    {concerts_with_fk}")
        print(f"     - Without countryId: {concerts_without_fk}")
        print(f"   CityMapping table:")
        print(f"     - With countryId:    {mappings_with_fk}")
        print(f"     - Without countryId: {mappings_without_fk}")
        
        # Sample verification
        print("\n6. Sample data:")
        sample_concerts = session.query(Concert).filter(Concert.countryId.isnot(None)).limit(5).all()
        for concert in sample_concerts:
            country = session.query(Country).filter_by(id=concert.countryId).first()
            print(f"   Concert '{concert.eventName[:40]}...'")
            print(f"     country: '{concert.country}' → countryId: {concert.countryId} ({country.name if country else 'NOT FOUND'})")
        
        if concerts_without_fk > 0 or mappings_without_fk > 0:
            print("\n⚠️  WARNING: Some records still have NULL countryId")
            print("   This is expected if there are NULL country values or unknown countries")
        
        print("\n" + "="*80)
        print("✅ PHASE 4 COMPLETE: Foreign keys populated successfully")
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
    populate_foreign_keys()
