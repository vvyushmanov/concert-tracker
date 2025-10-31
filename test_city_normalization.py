#!/usr/bin/env python3
"""
Test city normalization without writing to database
Shows how different city names get normalized
"""

import sys
sys.path.insert(0, 'concert-tracker/scripts')
from db_models import get_session
from city_normalizer import CityNormalizer


def test_normalization(db_path: str, test_cities: list = None, skip_manual: bool = False):
    """Test city normalization with various inputs
    
    Args:
        db_path: Path to database (for reading existing mappings)
        test_cities: List of (city, country) tuples to test
        skip_manual: If True, skip cities that have manual mappings
    """
    print("="*80)
    print("CITY NORMALIZATION TEST" + (" (GEOCODING ONLY)" if skip_manual else ""))
    print("="*80)
    print()
    
    # Get session (read-only, we won't commit)
    session = get_session(db_path)
    normalizer = CityNormalizer(session)
    
    # Default test cases if none provided
    if not test_cities:
        if skip_manual:
            # Test cities WITHOUT manual mappings - focus on geocoding
            test_cities = [
                # Test diacritics
                ("İstanbul", "Turkey"),
                ("İzmir", "Turkey"),
                ("Würzburg", "Germany"),
                ("Zürich", "Switzerland"),
                ("Köln", "Germany"),
                ("München", "Germany"),
                
                # Test case variations
                ("istanbul", "Turkey"),
                ("BERLIN", "Germany"),
                ("LoNdOn", "United Kingdom"),
                
                # Test parenthetical suffixes
                ("Barcelona (Hospitalet)", "Spain"),
                ("Milan (Assago)", "Italy"),
                
                # Test regular cities (should geocode)
                ("Madrid", "Spain"),
                ("Amsterdam", "Netherlands"),
                ("Rome", "Italy"),
                ("Athens", "Greece"),
                
                # Test abbreviations
                ("St. Petersburg", "Russia"),
                ("St Louis", "United States"),
                
                # Test smaller cities near larger ones (clustering test)
                ("Hospitalet de Llobregat", "Spain"),  # Near Barcelona
                ("Assago", "Italy"),  # Near Milan
            ]
        else:
            test_cities = [
                # Test diacritics
                ("İstanbul", "Turkey"),
                ("İzmir", "Turkey"),
                ("Würzburg", "Germany"),
                ("Zürich", "Switzerland"),
                
                # Test case variations
                ("istanbul", "Turkey"),
                ("PARIS", "France"),
                ("LoNdOn", "United Kingdom"),
                
                # Test parenthetical suffixes
                ("Lyon (Décines-Charpieu)", "France"),
                ("Paris (Nanterre)", "France"),
                
                # Test known manual mappings
                ("Villeurbanne", "France"),
                ("Décines-Charpieu", "France"),
                ("Saint-Denis", "France"),
                ("Camden", "United Kingdom"),
                
                # Test regular cities
                ("Berlin", "Germany"),
                ("Madrid", "Spain"),
                ("Amsterdam", "Netherlands"),
                
                # Test abbreviations
                ("St. Petersburg", "Russia"),
                ("St Louis", "United States"),
            ]
    
    print(f"Testing {len(test_cities)} city names...\n")
    
    results = []
    from db_models import CityMapping
    
    for original_city, country in test_cities:
        try:
            normalized = normalizer.normalize(original_city, country)
            
            # Check source of normalization
            mapping = session.query(CityMapping).filter(
                CityMapping.originalCity == original_city,
                CityMapping.country == country
            ).first()
            
            source = 'text_normalized'
            if mapping:
                source = mapping.source
            
            results.append({
                'original': original_city,
                'normalized': normalized,
                'country': country,
                'changed': original_city != normalized,
                'source': source
            })
            
        except Exception as e:
            print(f"❌ Error normalizing '{original_city}' ({country}): {e}")
            results.append({
                'original': original_city,
                'normalized': 'ERROR',
                'country': country,
                'changed': False
            })
    
    # Rollback to ensure nothing was written
    session.rollback()
    session.close()
    
    # Print results
    print(f"{'Original City':<30} {'Country':<20} {'→':<3} {'Normalized City':<25} {'Source':<15}")
    print("-"*95)
    
    for result in results:
        arrow = "→" if result['changed'] else "="
        marker = "✓" if result['changed'] else " "
        
        print(f"{marker} {result['original']:<28} {result['country']:<20} {arrow:<3} {result['normalized']:<25} {result['source']:<15}")
    
    # Summary
    changed_count = sum(1 for r in results if r['changed'])
    geocoded_count = sum(1 for r in results if r.get('source') == 'geocoded')
    manual_count = sum(1 for r in results if r.get('source') == 'manual')
    text_count = sum(1 for r in results if r.get('source') == 'text_normalized')
    
    print()
    print("="*95)
    print(f"SUMMARY: {changed_count}/{len(results)} cities were normalized")
    print(f"  - Manual mappings: {manual_count}")
    print(f"  - Geocoded: {geocoded_count}")
    print(f"  - Text normalized: {text_count}")
    print("="*95)
    print()
    print("✓ = City name was changed by normalization")
    print("  = City name remained the same")
    print()


def interactive_test(db_path: str):
    """Interactive mode - test cities one by one"""
    print("="*80)
    print("INTERACTIVE CITY NORMALIZATION TEST (VERBOSE MODE)")
    print("="*80)
    print("Enter city names to test normalization (or 'quit' to exit)")
    print()
    
    session = get_session(db_path)
    normalizer = CityNormalizer(session, verbose=True)
    
    try:
        while True:
            city = input("City name: ").strip()
            if city.lower() in ['quit', 'exit', 'q']:
                break
            
            if not city:
                continue
            
            country = input("Country: ").strip()
            if not country:
                print("Country is required!")
                continue
            
            try:
                normalized = normalizer.normalize(city, country)
                
                if city == normalized:
                    print(f"  → No change: '{normalized}'")
                else:
                    print(f"  → Normalized: '{city}' → '{normalized}'")
                
                # Check if mapping exists
                from db_models import CityMapping
                mapping = session.query(CityMapping).filter(
                    CityMapping.originalCity == city,
                    CityMapping.country == country
                ).first()
                
                if mapping:
                    print(f"  → Source: {mapping.source}")
                    if mapping.latitude and mapping.longitude:
                        print(f"  → Coordinates: {mapping.latitude}, {mapping.longitude}")
                
                print()
                
            except Exception as e:
                print(f"  ❌ Error: {e}\n")
        
        # Rollback to ensure nothing was written
        session.rollback()
        
    finally:
        session.close()
    
    print("\nTest completed. No changes were written to the database.")


if __name__ == '__main__':
    # Use in-memory database by default (database-independent)
    default_db = ':memory:'
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python test_city_normalization.py                              # Run default tests (in-memory DB)")
        print("  python test_city_normalization.py <db_path>                    # Run with specific database")
        print("  python test_city_normalization.py [db_path] --geocoding-only   # Test geocoding only")
        print("  python test_city_normalization.py [db_path] -i                 # Interactive mode")
        print()
        print("Using in-memory database for testing...")
        test_normalization(default_db)
        sys.exit(0)
    
    # Check if first arg is a flag or db path
    if sys.argv[1] in ['-i', '--geocoding-only']:
        db_path = default_db
        flag = sys.argv[1]
    else:
        db_path = sys.argv[1]
        flag = sys.argv[2] if len(sys.argv) > 2 else None
    
    if flag == '-i':
        interactive_test(db_path)
    elif flag == '--geocoding-only':
        test_normalization(db_path, skip_manual=True)
    elif flag:
        print(f"Unknown option: {flag}")
        sys.exit(1)
    else:
        test_normalization(db_path)
