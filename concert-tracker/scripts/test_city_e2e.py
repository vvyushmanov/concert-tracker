#!/usr/bin/env python3
"""
End-to-end test for city normalization with diacritics.

Simulates the full concert parsing flow to verify that cities with diacritics
are properly stored in both Concert and CityMapping tables.
"""

import sys
from datetime import datetime, timezone
from database.models import Concert, CityMapping, CityNormalized, Country, Artist, ArtistConcert
from database.writer import ConcertDatabaseWriter
from database.config import get_engine
from sqlalchemy.orm import sessionmaker

def test_concert_with_diacritics():
    """Test end-to-end flow with concerts in both Dusseldorf and Düsseldorf
    
    This test simulates the real-world scenario where:
    1. First concert comes in with "Dusseldorf" (no umlaut)
    2. Second concert comes in with "Düsseldorf" (with umlaut)
    
    Both should create separate CityMapping records with their respective originalCity values.
    """
    
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    session = Session()
    
    # Track what we create for cleanup
    created_concert_ids = []
    created_mapping_ids = []
    created_artist_ids = []
    
    try:
        print("\n" + "="*80)
        print("END-TO-END TEST: Dusseldorf vs Düsseldorf (Two Concerts)")
        print("="*80)
        
        # Step 0: Clean up any leftover test data from previous runs
        print("\n[STEP 0] Cleaning up any leftover test data...")
        
        # Delete any existing test concerts
        test_urls = [
            'https://test.com/concert-dusseldorf-no-umlaut',
            'https://test.com/concert-dusseldorf-with-umlaut'
        ]
        for url in test_urls:
            existing_concert = session.query(Concert).filter(Concert.eventUrl == url).first()
            if existing_concert:
                session.query(ArtistConcert).filter(
                    ArtistConcert.concertId == existing_concert.id
                ).delete()
                session.delete(existing_concert)
                print(f"  Deleted leftover concert (ID: {existing_concert.id})")
        
        # Delete any existing test artists
        test_artists = ['Test Band E2E No Umlaut', 'Test Band E2E With Umlaut']
        for artist_name in test_artists:
            existing_artist = session.query(Artist).filter(Artist.name == artist_name).first()
            if existing_artist:
                session.delete(existing_artist)
                print(f"  Deleted leftover artist (ID: {existing_artist.id})")
        
        # Delete test CityMappings and CityNormalized if they exist
        country = session.query(Country).filter(Country.name == 'Germany').first()
        if country:
            for city_name in ['Dusseldorf', 'Düsseldorf']:
                test_mapping = session.query(CityMapping).filter(
                    CityMapping.originalCity == city_name,
                    CityMapping.countryId == country.id,
                    CityMapping.source == 'geocoded'
                ).first()
                if test_mapping:
                    session.delete(test_mapping)
                    print(f"  Deleted leftover test mapping for '{city_name}' (ID: {test_mapping.id})")
            
            # Delete CityNormalized for Dusseldorf if exists
            test_normalized = session.query(CityNormalized).filter(
                CityNormalized.normalizedCity == 'Dusseldorf',
                CityNormalized.countryId == country.id
            ).first()
            if test_normalized:
                session.delete(test_normalized)
                print(f"  Deleted leftover CityNormalized for 'Dusseldorf' (ID: {test_normalized.id})")
        
        session.commit()
        print("  Cleanup completed")
        
        # Step 1: Prepare fake concert data (as it would come from parser)
        print("\n[STEP 1] Preparing fake concert data...")
        
        # Concert 1: WITHOUT umlaut (simulates first scan)
        concert1 = {
            'event_name': 'Test Concert 1 - No Umlaut',
            'event_url': 'https://test.com/concert-dusseldorf-no-umlaut',
            'date_start': '2026-06-15',
            'date_end': '2026-06-15',
            'venue': 'Test Venue 1',
            'city': 'Dusseldorf',  # NO UMLAUT
            'country': 'Germany',
            'postal_code': '40210',
            'performers': ['Test Band 1'],
            'image_url': 'https://test.com/image1.jpg',
            'matched_artists': ['Test Band E2E No Umlaut']
        }
        
        # Concert 2: WITH umlaut (simulates second scan)
        concert2 = {
            'event_name': 'Test Concert 2 - With Umlaut',
            'event_url': 'https://test.com/concert-dusseldorf-with-umlaut',
            'date_start': '2026-06-16',
            'date_end': '2026-06-16',
            'venue': 'Test Venue 2',
            'city': 'Düsseldorf',  # WITH UMLAUT
            'country': 'Germany',
            'postal_code': '40211',
            'performers': ['Test Band 2'],
            'image_url': 'https://test.com/image2.jpg',
            'matched_artists': ['Test Band E2E With Umlaut']
        }
        
        print(f"  Concert 1: '{concert1['city']}' (NO umlaut)")
        print(f"  Concert 2: '{concert2['city']}' (WITH umlaut)")
        print(f"  Country: Germany")
        
        # Step 2: Create fake artists
        print("\n[STEP 2] Creating fake artists...")
        
        artist1 = Artist(
            name='Test Band E2E No Umlaut',
            mbid='test-mbid-e2e-no-umlaut',
            imageUrl='https://test.com/artist1.jpg',
            createdAt=int(datetime.now(timezone.utc).timestamp()),
            updatedAt=int(datetime.now(timezone.utc).timestamp())
        )
        artist2 = Artist(
            name='Test Band E2E With Umlaut',
            mbid='test-mbid-e2e-with-umlaut',
            imageUrl='https://test.com/artist2.jpg',
            createdAt=int(datetime.now(timezone.utc).timestamp()),
            updatedAt=int(datetime.now(timezone.utc).timestamp())
        )
        session.add(artist1)
        session.add(artist2)
        session.commit()
        created_artist_ids.extend([artist1.id, artist2.id])
        
        print(f"  Created artist 1: {artist1.name} (ID: {artist1.id})")
        print(f"  Created artist 2: {artist2.name} (ID: {artist2.id})")
        
        # Step 3: Process FIRST concert (Dusseldorf - no umlaut)
        print("\n[STEP 3] Processing FIRST concert (Dusseldorf - NO umlaut)...")
        print("-" * 80)
        
        writer1 = ConcertDatabaseWriter(
            db_path=None,
            user_id=1,
            debug=True
        )
        
        artist_mbids1 = {'Test Band E2E No Umlaut': 'test-mbid-e2e-no-umlaut'}
        artist_playcounts1 = {'Test Band E2E No Umlaut': 100}
        artist_playcounts_12month1 = {'Test Band E2E No Umlaut': 50}
        recent_artists1 = {'Test Band E2E No Umlaut'}
        
        writer1.write_concerts(
            concerts=[concert1],
            artist_playcounts=artist_playcounts1,
            artist_playcounts_12month=artist_playcounts_12month1,
            recent_artists=recent_artists1,
            artist_mbids=artist_mbids1
        )
        
        print("-" * 80)
        print("[STEP 3] First concert completed")
        
        # Step 4: Process SECOND concert (Düsseldorf - with umlaut)
        print("\n[STEP 4] Processing SECOND concert (Düsseldorf - WITH umlaut)...")
        print("-" * 80)
        
        writer2 = ConcertDatabaseWriter(
            db_path=None,
            user_id=1,
            debug=True
        )
        
        artist_mbids2 = {'Test Band E2E With Umlaut': 'test-mbid-e2e-with-umlaut'}
        artist_playcounts2 = {'Test Band E2E With Umlaut': 100}
        artist_playcounts_12month2 = {'Test Band E2E With Umlaut': 50}
        recent_artists2 = {'Test Band E2E With Umlaut'}
        
        writer2.write_concerts(
            concerts=[concert2],
            artist_playcounts=artist_playcounts2,
            artist_playcounts_12month=artist_playcounts_12month2,
            recent_artists=recent_artists2,
            artist_mbids=artist_mbids2
        )
        
        print("-" * 80)
        print("[STEP 4] Both concerts completed")
        
        # Create a fresh session to see the changes made by the writer
        # (writer has its own session and commits independently)
        session.close()
        session = Session()
        
        # Step 5: Verify BOTH concerts were created with correct cities
        print("\n[STEP 5] Verifying Concert records...")
        
        # Verify Concert 1 (no umlaut)
        concert_1 = session.query(Concert).filter(
            Concert.eventUrl == concert1['event_url']
        ).first()
        
        if not concert_1:
            print("  ❌ FAIL: Concert 1 not created!")
            return 1
        
        created_concert_ids.append(concert_1.id)
        
        print(f"\n  Concert 1 (NO umlaut):")
        print(f"    ID: {concert_1.id}")
        print(f"    cityMappingId: {concert_1.cityMappingId}")
        
        test1_pass = concert_1.cityMappingId is not None
        if test1_pass:
            print(f"    ✅ PASS: Concert 1 has cityMappingId: {concert_1.cityMappingId}")
        else:
            print(f"    ❌ FAIL: Expected cityMappingId, got None")
        
        # Verify Concert 2 (with umlaut)
        concert_2 = session.query(Concert).filter(
            Concert.eventUrl == concert2['event_url']
        ).first()
        
        if not concert_2:
            print("  ❌ FAIL: Concert 2 not created!")
            return 1
        
        created_concert_ids.append(concert_2.id)
        
        print(f"\n  Concert 2 (WITH umlaut):")
        print(f"    ID: {concert_2.id}")
        print(f"    cityMappingId: {concert_2.cityMappingId}")
        
        test2_pass = concert_2.cityMappingId is not None
        if test2_pass:
            print(f"    ✅ PASS: Concert 2 has cityMappingId: {concert_2.cityMappingId}")
        else:
            print(f"    ❌ FAIL: Expected cityMappingId, got None")
        
        # Step 6: Verify BOTH CityMappings were created
        print("\n[STEP 6] Verifying CityMapping records...")
        
        country = session.query(Country).filter(Country.name == 'Germany').first()
        if not country:
            print("  ❌ FAIL: Germany country not found!")
            return 1
        
        # Check for mapping 1 (no umlaut)
        mapping_1 = session.query(CityMapping).filter(
            CityMapping.originalCity == 'Dusseldorf',
            CityMapping.countryId == country.id
        ).first()
        
        print(f"\n  CityMapping 1 (NO umlaut):")
        if not mapping_1:
            print(f"    ❌ FAIL: CityMapping not created for 'Dusseldorf'!")
            test3_pass = False
        else:
            created_mapping_ids.append(mapping_1.id)
            print(f"    ID: {mapping_1.id}")
            print(f"    Original City: '{mapping_1.originalCity}'")
            print(f"    cityNormalizedId: {mapping_1.cityNormalizedId}")
            test3_pass = mapping_1.originalCity == 'Dusseldorf' and mapping_1.cityNormalizedId is not None
            if test3_pass:
                print(f"    ✅ PASS: Mapping 1 originalCity correct and has cityNormalizedId: '{mapping_1.originalCity}'")
            else:
                print(f"    ❌ FAIL: Expected 'Dusseldorf' with cityNormalizedId, got '{mapping_1.originalCity}' (cityNormalizedId: {mapping_1.cityNormalizedId})")
        
        # Check for mapping 2 (with umlaut) - THIS IS THE CRITICAL TEST
        mapping_2 = session.query(CityMapping).filter(
            CityMapping.originalCity == 'Düsseldorf',
            CityMapping.countryId == country.id
        ).first()
        
        print(f"\n  CityMapping 2 (WITH umlaut):")
        if not mapping_2:
            print(f"    ❌ FAIL: CityMapping not created for 'Düsseldorf'!")
            
            # Show what mappings exist
            all_mappings = session.query(CityMapping).filter(
                CityMapping.countryId == country.id
            ).all()
            print(f"\n    Found {len(all_mappings)} total mappings for Germany:")
            for m in all_mappings:
                print(f"      - originalCity: '{m.originalCity}' (ID: {m.id})")
            
            test4_pass = False
        else:
            created_mapping_ids.append(mapping_2.id)
            print(f"    ID: {mapping_2.id}")
            print(f"    Original City: '{mapping_2.originalCity}'")
            print(f"    cityNormalizedId: {mapping_2.cityNormalizedId}")
            test4_pass = mapping_2.originalCity == 'Düsseldorf' and mapping_2.cityNormalizedId is not None
            if test4_pass:
                print(f"    ✅ PASS: Mapping 2 originalCity preserves umlaut and has cityNormalizedId: '{mapping_2.originalCity}'")
            else:
                print(f"    ❌ FAIL: Expected 'Düsseldorf' with cityNormalizedId, got '{mapping_2.originalCity}' (cityNormalizedId: {mapping_2.cityNormalizedId})")
        
        # Verify we have TWO separate mappings
        total_mappings = session.query(CityMapping).filter(
            CityMapping.countryId == country.id
        ).count()
        
        print(f"\n  Total mappings for Germany: {total_mappings}")
        test5_pass = total_mappings >= 2
        if test5_pass:
            print(f"  ✅ PASS: Both mappings created (found {total_mappings})")
        else:
            print(f"  ❌ FAIL: Expected 2+ mappings, found {total_mappings}")
        
        # NEW TEST: Verify CityNormalized record exists and both mappings link to it
        print(f"\n[STEP 6.5] Verifying CityNormalized record...")
        
        city_normalized = session.query(CityNormalized).filter(
            CityNormalized.normalizedCity == 'Dusseldorf',
            CityNormalized.countryId == country.id
        ).first()
        
        if not city_normalized:
            print(f"  ❌ FAIL: CityNormalized record not found for 'Dusseldorf'!")
            test6_pass = False
        else:
            print(f"  CityNormalized:")
            print(f"    ID: {city_normalized.id}")
            print(f"    Normalized City: '{city_normalized.normalizedCity}'")
            print(f"    Country ID: {city_normalized.countryId}")
            
            # Verify both mappings link to this CityNormalized
            if mapping_1 and mapping_2:
                both_link = (mapping_1.cityNormalizedId == city_normalized.id and 
                           mapping_2.cityNormalizedId == city_normalized.id)
                test6_pass = both_link
                if test6_pass:
                    print(f"    ✅ PASS: Both CityMappings link to same CityNormalized (ID: {city_normalized.id})")
                else:
                    print(f"    ❌ FAIL: Mappings don't link correctly (mapping1: {mapping_1.cityNormalizedId}, mapping2: {mapping_2.cityNormalizedId})")
            else:
                test6_pass = False
                print(f"    ❌ FAIL: Cannot verify links - mappings not found")
        
        # Step 7: Cleanup
        print("\n[STEP 7] Cleaning up test data...")
        
        # Delete ArtistConcert links
        for concert_id in created_concert_ids:
            artist_concert_links = session.query(ArtistConcert).filter(
                ArtistConcert.concertId == concert_id
            ).all()
            for link in artist_concert_links:
                session.delete(link)
                print(f"  Deleted ArtistConcert link (ID: {link.id})")
        
        # Delete Concerts
        for concert_id in created_concert_ids:
            concert_to_delete = session.query(Concert).filter(Concert.id == concert_id).first()
            if concert_to_delete:
                session.delete(concert_to_delete)
                print(f"  Deleted Concert (ID: {concert_id})")
        
        # Delete CityMappings
        for mapping_id in created_mapping_ids:
            mapping_to_delete = session.query(CityMapping).filter(CityMapping.id == mapping_id).first()
            if mapping_to_delete:
                session.delete(mapping_to_delete)
                print(f"  Deleted CityMapping (ID: {mapping_id})")
        
        # Delete CityNormalized (after mappings are deleted due to FK)
        if country:
            city_normalized_to_delete = session.query(CityNormalized).filter(
                CityNormalized.normalizedCity == 'Dusseldorf',
                CityNormalized.countryId == country.id
            ).first()
            if city_normalized_to_delete:
                session.delete(city_normalized_to_delete)
                print(f"  Deleted CityNormalized (ID: {city_normalized_to_delete.id})")
        
        # Delete Artists
        for artist_id in created_artist_ids:
            artist_to_delete = session.query(Artist).filter(Artist.id == artist_id).first()
            if artist_to_delete:
                session.delete(artist_to_delete)
                print(f"  Deleted Artist (ID: {artist_id})")
        
        session.commit()
        print("  ✅ Cleanup completed")
        
        # Summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        all_tests = [
            ("Concert 1 has cityMappingId", test1_pass),
            ("Concert 2 has cityMappingId", test2_pass),
            ("CityMapping 1 (no umlaut) originalCity='Dusseldorf' with cityNormalizedId", test3_pass),
            ("CityMapping 2 (with umlaut) originalCity='Düsseldorf' with cityNormalizedId", test4_pass),
            ("Both mappings created (2+ total)", test5_pass),
            ("CityNormalized exists and both mappings link to it", test6_pass),
        ]
        
        passed = sum(1 for _, result in all_tests if result)
        total = len(all_tests)
        
        for test_name, result in all_tests:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status}: {test_name}")
        
        print(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            print("\n🎉 All tests passed! End-to-end flow works correctly.")
            return 0
        else:
            print(f"\n❌ {total - passed} test(s) failed")
            return 1
        
    except Exception as e:
        print(f"\n❌ Test error: {e}")
        import traceback
        traceback.print_exc()
        
        # Attempt cleanup on error
        print("\n[CLEANUP ON ERROR] Attempting to clean up...")
        try:
            session.rollback()  # Rollback the failed transaction first
            
            if created_concert_ids:
                # Delete ArtistConcert links first
                for concert_id in created_concert_ids:
                    artist_concert_links = session.query(ArtistConcert).filter(
                        ArtistConcert.concertId == concert_id
                    ).all()
                    for link in artist_concert_links:
                        session.delete(link)
                    
                    concert = session.query(Concert).filter(Concert.id == concert_id).first()
                    if concert:
                        session.delete(concert)
            
            if created_mapping_id:
                mapping = session.query(CityMapping).filter(CityMapping.id == created_mapping_id).first()
                if mapping:
                    session.delete(mapping)
            
            if created_artist_id:
                artist = session.query(Artist).filter(Artist.id == created_artist_id).first()
                if artist:
                    session.delete(artist)
            
            # Also clean up test artist by name
            test_artist = session.query(Artist).filter(Artist.name == 'Test Band E2E').first()
            if test_artist:
                session.delete(test_artist)
            
            session.commit()
            print("  Cleanup completed")
        except Exception as cleanup_error:
            print(f"  Cleanup error: {cleanup_error}")
            session.rollback()
        
        return 1
    finally:
        session.close()

if __name__ == '__main__':
    sys.exit(test_concert_with_diacritics())
