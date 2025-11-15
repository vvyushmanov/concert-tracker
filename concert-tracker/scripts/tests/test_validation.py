#!/usr/bin/env python3
"""
Test suite for validation utilities

Tests all validation functions with various scenarios
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils.validation import (
    validate_artist_sources,
    validate_database_connection,
    validate_country_codes,
    validate_user_id,
    ValidationStatus
)


def test_artist_sources_no_filter():
    """Test validation with --no-filter mode (should always pass)"""
    print("\n" + "="*60)
    print("TEST: Artist Sources - No Filter Mode")
    print("="*60)

    result = validate_artist_sources(
        user_id=1,
        lastfm_configured=False,
        userartist_count=0,
        no_filter=True
    )

    print(result)
    assert result.is_valid(), "No-filter mode should always be valid"
    assert result.status == ValidationStatus.VALID
    print("✓ PASSED: No-filter mode validation")


def test_artist_sources_no_sources():
    """Test validation with no artist sources (should fail)"""
    print("\n" + "="*60)
    print("TEST: Artist Sources - No Sources Available")
    print("="*60)

    result = validate_artist_sources(
        user_id=1,
        lastfm_configured=False,
        userartist_count=0,
        no_filter=False
    )

    print(result)
    assert result.is_error(), "No sources should result in error"
    assert result.status == ValidationStatus.ERROR
    assert len(result.suggestions) == 3, "Should provide 3 suggestions"
    print("✓ PASSED: No sources validation")


def test_artist_sources_lastfm_only():
    """Test validation with Last.fm only (should warn)"""
    print("\n" + "="*60)
    print("TEST: Artist Sources - Last.fm Only")
    print("="*60)

    result = validate_artist_sources(
        user_id=1,
        lastfm_configured=True,
        userartist_count=0,
        no_filter=False
    )

    print(result)
    assert result.is_valid(), "Last.fm only should be valid but warn"
    assert result.status == ValidationStatus.WARNING
    assert "Last.fm only" in result.message
    print("✓ PASSED: Last.fm only validation")


def test_artist_sources_userartist_only():
    """Test validation with UserArtist only (should warn)"""
    print("\n" + "="*60)
    print("TEST: Artist Sources - UserArtist Only")
    print("="*60)

    result = validate_artist_sources(
        user_id=1,
        lastfm_configured=False,
        userartist_count=50,
        no_filter=False
    )

    print(result)
    assert result.is_valid(), "UserArtist only should be valid but warn"
    assert result.status == ValidationStatus.WARNING
    assert "UserArtist only" in result.message
    assert "50 artists" in result.message
    print("✓ PASSED: UserArtist only validation")


def test_artist_sources_both():
    """Test validation with both sources (optimal)"""
    print("\n" + "="*60)
    print("TEST: Artist Sources - Both Sources (Optimal)")
    print("="*60)

    result = validate_artist_sources(
        user_id=1,
        lastfm_configured=True,
        userartist_count=100,
        no_filter=False
    )

    print(result)
    assert result.is_valid(), "Both sources should be valid"
    assert result.status == ValidationStatus.VALID
    assert "optimal" in result.message.lower()
    assert "100 artists" in result.message
    print("✓ PASSED: Both sources validation")


def test_database_sqlite_not_found():
    """Test SQLite database validation - file not found"""
    print("\n" + "="*60)
    print("TEST: Database - SQLite Not Found")
    print("="*60)

    result = validate_database_connection(
        db_path="/nonexistent/database.db",
        db_type="sqlite"
    )

    print(result)
    assert result.is_error(), "Missing database should result in error"
    assert result.status == ValidationStatus.ERROR
    assert "not found" in result.message.lower()
    print("✓ PASSED: SQLite not found validation")


def test_database_mysql_url():
    """Test MySQL database validation - URL format"""
    print("\n" + "="*60)
    print("TEST: Database - MySQL URL Format")
    print("="*60)

    # Valid URL
    result = validate_database_connection(
        db_path="mysql://user:pass@localhost:3306/concerts",
        db_type="mysql"
    )

    print(result)
    assert result.is_valid(), "Valid MySQL URL should pass"
    assert result.status == ValidationStatus.VALID
    print("✓ PASSED: Valid MySQL URL")

    # Invalid URL
    result = validate_database_connection(
        db_path="invalid_connection_string",
        db_type="mysql"
    )

    print(result)
    assert result.is_error(), "Invalid MySQL URL should fail"
    assert result.status == ValidationStatus.ERROR
    print("✓ PASSED: Invalid MySQL URL")


def test_country_codes_empty():
    """Test country code validation - empty list"""
    print("\n" + "="*60)
    print("TEST: Country Codes - Empty List")
    print("="*60)

    result = validate_country_codes([])

    print(result)
    assert result.is_error(), "Empty country codes should fail"
    assert result.status == ValidationStatus.ERROR
    print("✓ PASSED: Empty country codes validation")


def test_country_codes_invalid_format():
    """Test country code validation - invalid format"""
    print("\n" + "="*60)
    print("TEST: Country Codes - Invalid Format")
    print("="*60)

    result = validate_country_codes(['tr', 'usa', 'de'])  # 'usa' is 3 letters

    print(result)
    assert result.is_error(), "Invalid country codes should fail"
    assert result.status == ValidationStatus.ERROR
    assert "usa" in result.message.lower()
    print("✓ PASSED: Invalid country code format validation")


def test_country_codes_valid():
    """Test country code validation - valid codes"""
    print("\n" + "="*60)
    print("TEST: Country Codes - Valid Codes")
    print("="*60)

    result = validate_country_codes(['tr', 'de', 'us', 'fr'])

    print(result)
    assert result.is_valid(), "Valid country codes should pass"
    assert result.status == ValidationStatus.VALID
    assert "4 countries" in result.message
    print("✓ PASSED: Valid country codes validation")


def test_user_id_none():
    """Test user ID validation - None"""
    print("\n" + "="*60)
    print("TEST: User ID - None")
    print("="*60)

    result = validate_user_id(None)

    print(result)
    assert result.is_error(), "None user ID should fail"
    assert result.status == ValidationStatus.ERROR
    print("✓ PASSED: None user ID validation")


def test_user_id_invalid():
    """Test user ID validation - invalid values"""
    print("\n" + "="*60)
    print("TEST: User ID - Invalid Values")
    print("="*60)

    # Zero
    result = validate_user_id(0)
    print(result)
    assert result.is_error(), "Zero user ID should fail"

    # Negative
    result = validate_user_id(-1)
    print(result)
    assert result.is_error(), "Negative user ID should fail"

    print("✓ PASSED: Invalid user ID validation")


def test_user_id_valid():
    """Test user ID validation - valid ID"""
    print("\n" + "="*60)
    print("TEST: User ID - Valid ID")
    print("="*60)

    result = validate_user_id(1)

    print(result)
    assert result.is_valid(), "Valid user ID should pass"
    assert result.status == ValidationStatus.VALID
    assert "1" in result.message
    print("✓ PASSED: Valid user ID validation")


def run_all_tests():
    """Run all validation tests"""
    print("\n" + "="*60)
    print("VALIDATION UTILITIES TEST SUITE")
    print("="*60)

    tests = [
        # Artist source validation
        test_artist_sources_no_filter,
        test_artist_sources_no_sources,
        test_artist_sources_lastfm_only,
        test_artist_sources_userartist_only,
        test_artist_sources_both,

        # Database validation
        test_database_sqlite_not_found,
        test_database_mysql_url,

        # Country code validation
        test_country_codes_empty,
        test_country_codes_invalid_format,
        test_country_codes_valid,

        # User ID validation
        test_user_id_none,
        test_user_id_invalid,
        test_user_id_valid,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"\n✗ FAILED: {test.__name__}")
            print(f"  Error: {e}")
            failed += 1
        except Exception as e:
            print(f"\n✗ ERROR: {test.__name__}")
            print(f"  Exception: {e}")
            failed += 1

    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Total tests: {len(tests)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")

    if failed == 0:
        print("\n✓ ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n✗ {failed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
