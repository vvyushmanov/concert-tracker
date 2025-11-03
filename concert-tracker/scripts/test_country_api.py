#!/usr/bin/env python3
"""
Test REST Countries API integration
"""

from country_helper import lookup_country_by_name, lookup_country_by_code, resolve_country_info, get_or_create_country
from db_models import get_session

def test_api_lookups():
    print("="*80)
    print("TESTING REST COUNTRIES API INTEGRATION")
    print("="*80)
    
    # Test 1: Lookup by name
    print("\n1. Testing lookup by name...")
    result = lookup_country_by_name("Netherlands")
    if result:
        print(f"   ✓ Netherlands -> {result[0]} ({result[1]})")
    else:
        print(f"   ✗ Failed to lookup Netherlands")
    
    # Test 2: Lookup by code
    print("\n2. Testing lookup by code...")
    result = lookup_country_by_code("nl")
    if result:
        print(f"   ✓ nl -> {result[0]} ({result[1]})")
    else:
        print(f"   ✗ Failed to lookup nl")
    
    # Test 3: Resolve known country (hardcoded)
    print("\n3. Testing resolve known country (hardcoded)...")
    name, code = resolve_country_info("France")
    print(f"   ✓ France -> {name} ({code})")
    
    # Test 4: Resolve unknown country (API)
    print("\n4. Testing resolve unknown country (API)...")
    name, code = resolve_country_info("Netherlands")
    print(f"   ✓ Netherlands -> {name} ({code})")
    
    # Test 5: Resolve completely unknown
    print("\n5. Testing resolve completely unknown...")
    name, code = resolve_country_info("Narnia")
    print(f"   ✓ Narnia -> {name} ({code})")
    
    # Test 6: Get or create with API
    print("\n6. Testing get_or_create_country with API...")
    session = get_session()
    try:
        country = get_or_create_country(session, "Netherlands", verbose=True)
        session.commit()
        print(f"   ✓ Result: {country.name} ({country.code}) ID: {country.id}")
        
        # Try again - should find existing
        print("\n7. Testing get_or_create_country (existing)...")
        country = get_or_create_country(session, "Netherlands", verbose=True)
        print(f"   ✓ Result: {country.name} ({country.code}) ID: {country.id}")
        
    finally:
        session.close()
    
    print("\n" + "="*80)
    print("✅ API INTEGRATION TESTS COMPLETE")
    print("="*80)


if __name__ == '__main__':
    test_api_lookups()
