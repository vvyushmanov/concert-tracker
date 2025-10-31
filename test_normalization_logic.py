#!/usr/bin/env python3
"""
Automated test suite for city normalization logic
Tests the complete normalization flow with assertions
"""

import sys
import os
sys.path.insert(0, 'concert-tracker/scripts')
from db_models import get_session, CityMapping
from city_normalizer import CityNormalizer


class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def assert_equal(self, actual, expected, test_name):
        if actual == expected:
            self.passed += 1
            print(f"  ✓ {test_name}")
            return True
        else:
            self.failed += 1
            error = f"  ✗ {test_name}\n    Expected: '{expected}'\n    Got: '{actual}'"
            print(error)
            self.errors.append(error)
            return False
    
    def print_summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*80}")
        print(f"TEST SUMMARY")
        print(f"{'='*80}")
        print(f"Total tests: {total}")
        print(f"Passed: {self.passed} ({self.passed/total*100:.1f}%)" if total > 0 else "Passed: 0")
        print(f"Failed: {self.failed}")
        if self.errors:
            print(f"\nFailed tests:")
            for error in self.errors:
                print(error)
        print(f"{'='*80}\n")
        return self.failed == 0


def test_cache_hit(normalizer, results):
    """Test that cached mappings are returned immediately"""
    print("\n1. Testing cache hit (database lookup)...")
    
    # First normalization - will geocode and cache
    result1 = normalizer.normalize("Villeurbanne", "France")
    
    # Second normalization - should hit cache
    result2 = normalizer.normalize("Villeurbanne", "France")
    
    results.assert_equal(result1, "Lyon", "First call: Villeurbanne → Lyon")
    results.assert_equal(result2, "Lyon", "Second call: Cache hit for Villeurbanne → Lyon")


def test_text_normalization(normalizer, results):
    """Test that text normalization works correctly"""
    print("\n2. Testing text normalization...")
    
    # Diacritics removal
    result = normalizer.normalize("İstanbul", "Turkey")
    results.assert_equal(result, "Istanbul", "Diacritics: İstanbul → Istanbul")
    
    result = normalizer.normalize("Zürich", "Switzerland")
    results.assert_equal(result, "Zurich", "Diacritics: Zürich → Zurich")
    
    # Case normalization
    result = normalizer.normalize("PARIS", "France")
    results.assert_equal(result, "Paris", "Case: PARIS → Paris")
    
    result = normalizer.normalize("london", "United Kingdom")
    results.assert_equal(result, "London", "Case: london → London")


def test_clustering(normalizer, results):
    """Test that metropolitan area clustering works"""
    print("\n3. Testing metropolitan area clustering...")
    
    # Villeurbanne should cluster to Lyon (within 35km, Lyon is larger)
    result = normalizer.normalize("Villeurbanne", "France")
    results.assert_equal(result, "Lyon", "Clustering: Villeurbanne → Lyon")
    
    # Décines-Charpieu should also cluster to Lyon
    result = normalizer.normalize("Décines-Charpieu", "France")
    results.assert_equal(result, "Lyon", "Clustering: Décines-Charpieu → Lyon")


def test_major_cities_no_clustering(normalizer, results):
    """Test that major cities (pop >= 400k) don't get clustered"""
    print("\n4. Testing major cities (no clustering)...")
    
    # Istanbul is major city (15M+ pop) - should not cluster
    result = normalizer.normalize("Istanbul", "Turkey")
    results.assert_equal(result, "Istanbul", "Major city: Istanbul stays Istanbul")
    
    # Paris is major city (2M+ pop) - should not cluster
    result = normalizer.normalize("Paris", "France")
    results.assert_equal(result, "Paris", "Major city: Paris stays Paris")
    
    # Lyon is major city (522k pop) - should not cluster
    result = normalizer.normalize("Lyon", "France")
    results.assert_equal(result, "Lyon", "Major city: Lyon stays Lyon")


def test_cache_after_normalization(normalizer, results):
    """Test that results are cached after first normalization"""
    print("\n5. Testing caching after normalization...")
    
    # Clear any existing mapping for test city
    session = normalizer.db
    session.query(CityMapping).filter(
        CityMapping.originalCity == "TestCity",
        CityMapping.country == "TestCountry"
    ).delete()
    session.commit()
    
    # First call - will geocode (or return text normalized if geocoding fails)
    result1 = normalizer.normalize("TestCity", "TestCountry")
    
    # Second call - should hit cache
    result2 = normalizer.normalize("TestCity", "TestCountry")
    
    results.assert_equal(result1, result2, "Cache: Second call returns same result")


def test_no_change_cities(normalizer, results):
    """Test cities that don't need normalization but might need clustering"""
    print("\n6. Testing cities that don't need text normalization...")
    
    # Villeurbanne: text doesn't change, but SHOULD still geocode and cluster to Lyon
    result = normalizer.normalize("Villeurbanne", "France")
    results.assert_equal(result, "Lyon", "No text change but clusters: Villeurbanne → Lyon")
    
    # Paris: text doesn't change, geocodes but doesn't cluster (major city)
    result = normalizer.normalize("Paris", "France")
    results.assert_equal(result, "Paris", "No text change, no clustering: Paris → Paris")


def test_normalization_order(normalizer, results):
    """Test that normalization follows correct order: cache → text → geocode"""
    print("\n7. Testing normalization order...")
    
    # Test with a city that has diacritics and should cluster
    # First time: no cache → text normalize → geocode → cluster
    session = normalizer.db
    session.query(CityMapping).filter(
        CityMapping.originalCity == "Décines-Charpieu",
        CityMapping.country == "France"
    ).delete()
    session.commit()
    
    result = normalizer.normalize("Décines-Charpieu", "France")
    results.assert_equal(result, "Lyon", "Order test: Décines-Charpieu → Lyon")
    
    # Second time: cache hit → immediate return
    result = normalizer.normalize("Décines-Charpieu", "France")
    results.assert_equal(result, "Lyon", "Order test: Cache hit for Décines-Charpieu")


def run_all_tests(db_path: str = ':memory:', verbose: bool = False):
    """Run all normalization tests
    
    Args:
        db_path: Path to database (use :memory: for isolated testing)
        verbose: Enable verbose logging from normalizer
    """
    print("="*80)
    print("CITY NORMALIZATION LOGIC TEST SUITE")
    print("="*80)
    print(f"Database: {db_path}")
    print(f"Verbose: {verbose}")
    
    # Create session and normalizer
    session = get_session(db_path)
    normalizer = CityNormalizer(session, verbose=verbose)
    
    # Track results
    results = TestResult()
    
    # Run test suites
    try:
        test_cache_hit(normalizer, results)
        test_text_normalization(normalizer, results)
        test_clustering(normalizer, results)
        test_major_cities_no_clustering(normalizer, results)
        test_cache_after_normalization(normalizer, results)
        test_no_change_cities(normalizer, results)
        test_normalization_order(normalizer, results)
    except Exception as e:
        print(f"\n✗ Test suite error: {e}")
        import traceback
        traceback.print_exc()
        results.failed += 1
    
    # Print summary
    success = results.print_summary()
    
    # Close session
    session.close()
    
    return 0 if success else 1


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Test city normalization logic')
    parser.add_argument(
        '--db-path',
        default=':memory:',
        help='Database path (default: :memory: for isolated testing)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose logging from normalizer'
    )
    
    args = parser.parse_args()
    
    exit_code = run_all_tests(args.db_path, args.verbose)
    sys.exit(exit_code)
