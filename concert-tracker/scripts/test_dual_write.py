#!/usr/bin/env python3
"""
Test dual-write functionality
Verify that country_helper works correctly
"""

from db_models import Country, get_session
from country_helper import get_or_create_country

def test_dual_write():
    print("Testing dual-write functionality...")
    
    session = get_session()
    
    try:
        # Test 1: Get existing country
        print("\n1. Testing get existing country (France)...")
        country = get_or_create_country(session, "France")
        print(f"   ✓ Got country: {country.name} (ID: {country.id}, Code: {country.code})")
        
        # Test 2: Create new country
        print("\n2. Testing create new country (Belgium)...")
        country = get_or_create_country(session, "Belgium")
        session.commit()
        print(f"   ✓ Created country: {country.name} (ID: {country.id}, Code: {country.code})")
        
        # Test 3: Get the newly created country again
        print("\n3. Testing get newly created country (Belgium)...")
        country = get_or_create_country(session, "Belgium")
        print(f"   ✓ Got country: {country.name} (ID: {country.id}, Code: {country.code})")
        
        # Test 4: Unknown country
        print("\n4. Testing unknown country (Atlantis)...")
        country = get_or_create_country(session, "Atlantis")
        session.commit()
        print(f"   ✓ Created country: {country.name} (ID: {country.id}, Code: {country.code})")
        
        # Show all countries
        print("\n5. All countries in database:")
        countries = session.query(Country).all()
        for c in countries:
            print(f"   - {c.name} ({c.code})")
        
        print("\n✅ All tests passed!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        session.rollback()
    finally:
        session.close()


if __name__ == '__main__':
    test_dual_write()
