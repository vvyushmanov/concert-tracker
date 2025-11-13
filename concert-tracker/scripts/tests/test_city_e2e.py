#!/usr/bin/env python3
"""
End-to-end test for city normalization and float lat/lng storage.

Simulates the full concert parsing flow to verify that:
1. Cities are properly normalized and stored
2. Latitude/longitude are stored as floats (not strings)
3. CityMapping and CityNormalized relationships work correctly
"""

import sys
from datetime import datetime, timezone
from database.models import Concert, CityMapping, CityNormalized, Country, Artist, ArtistConcert
from database.writer import ConcertDatabaseWriter
from database.config import get_engine
from sqlalchemy.orm import sessionmaker

def test_concert_with_us_cities():
    """Test end-to-end flow with concerts in US cities
    
    This test simulates the real-world scenario where:
    1. First concert comes in with "Portland" (Oregon)
    2. Second concert comes in with "Seattle" (Washington)
    
    Both should create CityMapping records with float lat/lng values.
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
        print("END-TO-END TEST: Portland and Seattle (Two US Cities)")
        print("="*80)
        
        # Step 0: Clean up any leftover test data from previous runs
        print("\n[STEP 0] Cleaning up any leftover test data...")
        
        # Delete any existing test concerts
        test_urls = [
            'https://test.com/concert-portland-test',
            'https://test.com/concert-seattle-test'
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
        test_artists = ['Test Band E2E Portland', 'Test Band E2E Seattle']
        for artist_name in test_artists:
            existing_artist = session.query(Artist).filter(Artist.name == artist_name).first()
            if existing_artist:
                session.delete(existing_artist)
                print(f"  Deleted leftover artist (ID: {existing_artist.id})")
        
        # Delete test CityMappings and CityNormalized if they exist
        country = session.query(Country).filter(Country.name == 'United States').first()
        if country:
            for city_name in ['Portland', 'Seattle']:
                test_mapping = session.query(CityMapping).filter(
                    CityMapping.originalCity == city_name,
                    CityMapping.countryId == country.id,
                    CityMapping.source == 'geocoded'
                ).first()
                if test_mapping:
                    session.delete(test_mapping)
                    print(f"  Deleted leftover test mapping for '{city_name}' (ID: {test_mapping.id})")
            
            # Delete CityNormalized for Portland/Seattle if exists
            for city_name in ['Portland', 'Seattle']:
                test_normalized = session.query(CityNormalized).filter(
                    CityNormalized.normalizedCity == city_name,
                    CityNormalized.countryId == country.id
                ).first()
                if test_normalized:
                    session.delete(test_normalized)
                    print(f"  Deleted leftover CityNormalized for '{city_name}' (ID: {test_normalized.id})")
        
        session.commit()
        print("  Cleanup completed")
        
        # Step 1: Prepare fake concert data (as it would come from parser)
        print("\n[STEP 1] Preparing fake concert data...")
        
        # Concert 1: Portland
        concert1 = {
            'event_name': 'Test Concert 1 - Portland',
            'event_url': 'https://test.com/concert-portland-test',
            'date_start': '2026-06-15',
            'date_end': '2026-06-15',
            'venue': 'Test Venue Portland',
            'city': 'Portland',
            'country': 'United States',
            'postal_code': '97209',
            'performers': ['Test Band 1'],
            'image_url': 'https://test.com/image1.jpg',
            'matched_artists': ['Test Band E2E Portland']
        }
        
        # Concert 2: Seattle
        concert2 = {
            'event_name': 'Test Concert 2 - Seattle',
            'event_url': 'https://test.com/concert-seattle-test',
            'date_start': '2026-06-16',
            'date_end': '2026-06-16',
            'venue': 'Test Venue Seattle',
            'city': 'Seattle',
            'country': 'United States',
            'postal_code': '98101',
            'performers': ['Test Band 2'],
            'image_url': 'https://test.com/image2.jpg',
            'matched_artists': ['Test Band E2E Seattle']
        }
        
        print(f"  Concert 1: '{concert1['city']}'")
        print(f"  Concert 2: '{concert2['city']}'")
        print(f"  Country: United States")
        
        # Step 2: Create fake artists
        print("\n[STEP 2] Creating fake artists...")
        
        artist1 = Artist(
            name='Test Band E2E Portland',
            mbid='test-mbid-e2e-portland',
            imageUrl='https://test.com/artist1.jpg',
            createdAt=int(datetime.now(timezone.utc).timestamp()),
            updatedAt=int(datetime.now(timezone.utc).timestamp())
        )
        artist2 = Artist(
            name='Test Band E2E Seattle',
            mbid='test-mbid-e2e-seattle',
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
        
        # Step 3: Process FIRST concert (Portland)
        print("\n[STEP 3] Processing FIRST concert (Portland)...")
        print("-" * 80)
        
        writer1 = ConcertDatabaseWriter(
            db_path=None,
            user_id=1,
            debug=True
        )
        
        artist_mbids1 = {'Test Band E2E Portland': 'test-mbid-e2e-portland'}
        artist_playcounts1 = {'Test Band E2E Portland': 100}
        artist_playcounts_12month1 = {'Test Band E2E Portland': 50}
        recent_artists1 = {'Test Band E2E Portland'}
        
        writer1.write_concerts(
            concerts=[concert1],
            artist_playcounts=artist_playcounts1,
            artist_playcounts_12month=artist_playcounts_12month1,
            recent_artists=recent_artists1,
            artist_mbids=artist_mbids1
        )
        
        print("-" * 80)
        print("[STEP 3] First concert completed")
        
        # Step 4: Process SECOND concert (Seattle)
        print("\n[STEP 4] Processing SECOND concert (Seattle)...")
        print("-" * 80)
        
        writer2 = ConcertDatabaseWriter(
            db_path=None,
            user_id=1,
            debug=True
        )
        
        artist_mbids2 = {'Test Band E2E Seattle': 'test-mbid-e2e-seattle'}
        artist_playcounts2 = {'Test Band E2E Seattle': 100}
        artist_playcounts_12month2 = {'Test Band E2E Seattle': 50}
        recent_artists2 = {'Test Band E2E Seattle'}
        
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
        
        print(f"\n  Concert 1 (Portland):")
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
        
        print(f"\n  Concert 2 (Seattle):")
        print(f"    ID: {concert_2.id}")
        print(f"    cityMappingId: {concert_2.cityMappingId}")
        
        test2_pass = concert_2.cityMappingId is not None
        if test2_pass:
            print(f"    ✅ PASS: Concert 2 has cityMappingId: {concert_2.cityMappingId}")
        else:
            print(f"    ❌ FAIL: Expected cityMappingId, got None")
        
        # Step 6: Verify BOTH CityMappings were created
        print("\n[STEP 6] Verifying CityMapping records...")
        
        country = session.query(Country).filter(Country.name == 'United States').first()
        if not country:
            print("  ❌ FAIL: United States country not found!")
            return 1
        
        # Check for mapping 1 (Portland)
        mapping_1 = session.query(CityMapping).filter(
            CityMapping.originalCity == 'Portland',
            CityMapping.countryId == country.id
        ).first()
        
        print(f"\n  CityMapping 1 (Portland):")
        if not mapping_1:
            print(f"    ❌ FAIL: CityMapping not created for 'Portland'!")
            test3_pass = False
        else:
            created_mapping_ids.append(mapping_1.id)
            print(f"    ID: {mapping_1.id}")
            print(f"    Original City: '{mapping_1.originalCity}'")
            print(f"    Latitude: {mapping_1.latitude} (type: {type(mapping_1.latitude).__name__})")
            print(f"    Longitude: {mapping_1.longitude} (type: {type(mapping_1.longitude).__name__})")
            print(f"    cityNormalizedId: {mapping_1.cityNormalizedId}")
            test3_pass = (mapping_1.originalCity == 'Portland' and 
                         mapping_1.cityNormalizedId is not None and
                         isinstance(mapping_1.latitude, float) and
                         isinstance(mapping_1.longitude, float))
            if test3_pass:
                print(f"    ✅ PASS: Portland mapping correct with float lat/lng")
            else:
                print(f"    ❌ FAIL: Expected Portland with float lat/lng and cityNormalizedId")
        
        # Check for mapping 2 (Seattle)
        mapping_2 = session.query(CityMapping).filter(
            CityMapping.originalCity == 'Seattle',
            CityMapping.countryId == country.id
        ).first()
        
        print(f"\n  CityMapping 2 (Seattle):")
        if not mapping_2:
            print(f"    ❌ FAIL: CityMapping not created for 'Seattle'!")
            
            # Show what mappings exist
            all_mappings = session.query(CityMapping).filter(
                CityMapping.countryId == country.id
            ).all()
            print(f"\n    Found {len(all_mappings)} total mappings for United States:")
            for m in all_mappings:
                print(f"      - originalCity: '{m.originalCity}' (ID: {m.id})")
            
            test4_pass = False
        else:
            created_mapping_ids.append(mapping_2.id)
            print(f"    ID: {mapping_2.id}")
            print(f"    Original City: '{mapping_2.originalCity}'")
            print(f"    Latitude: {mapping_2.latitude} (type: {type(mapping_2.latitude).__name__})")
            print(f"    Longitude: {mapping_2.longitude} (type: {type(mapping_2.longitude).__name__})")
            print(f"    cityNormalizedId: {mapping_2.cityNormalizedId}")
            test4_pass = (mapping_2.originalCity == 'Seattle' and 
                         mapping_2.cityNormalizedId is not None and
                         isinstance(mapping_2.latitude, float) and
                         isinstance(mapping_2.longitude, float))
            if test4_pass:
                print(f"    ✅ PASS: Seattle mapping correct with float lat/lng")
            else:
                print(f"    ❌ FAIL: Expected Seattle with float lat/lng and cityNormalizedId")
        
        # Verify we have TWO separate mappings
        total_mappings = session.query(CityMapping).filter(
            CityMapping.countryId == country.id
        ).count()
        
        print(f"\n  Total mappings for United States: {total_mappings}")
        test5_pass = total_mappings >= 2
        if test5_pass:
            print(f"  ✅ PASS: Both mappings created (found {total_mappings})")
        else:
            print(f"  ❌ FAIL: Expected 2+ mappings, found {total_mappings}")
        
        # NEW TEST: Verify CityNormalized records exist
        print(f"\n[STEP 6.5] Verifying CityNormalized records...")
        
        city_normalized_1 = session.query(CityNormalized).filter(
            CityNormalized.normalizedCity == 'Portland',
            CityNormalized.countryId == country.id
        ).first()
        city_normalized_2 = session.query(CityNormalized).filter(
            CityNormalized.normalizedCity == 'Seattle',
            CityNormalized.countryId == country.id
        ).first()
        city_normalized = city_normalized_1  # For compatibility with existing code
        
        if not city_normalized_1 or not city_normalized_2:
            print(f"  ❌ FAIL: CityNormalized records not found!")
            test6_pass = False
        else:
            print(f"  CityNormalized (Portland):")
            print(f"    ID: {city_normalized_1.id}")
            print(f"    Normalized City: '{city_normalized_1.normalizedCity}'")
            print(f"  CityNormalized (Seattle):")
            print(f"    ID: {city_normalized_2.id}")
            print(f"    Normalized City: '{city_normalized_2.normalizedCity}'")
            
            # Verify mappings link to their respective CityNormalized
            if mapping_1 and mapping_2:
                links_correct = (mapping_1.cityNormalizedId == city_normalized_1.id and 
                               mapping_2.cityNormalizedId == city_normalized_2.id)
                test6_pass = links_correct
                if test6_pass:
                    print(f"    ✅ PASS: Both CityMappings link to their respective CityNormalized records")
                else:
                    print(f"    ❌ FAIL: Mappings don't link correctly")
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
            for city_name in ['Portland', 'Seattle']:
                city_normalized_to_delete = session.query(CityNormalized).filter(
                    CityNormalized.normalizedCity == city_name,
                    CityNormalized.countryId == country.id
                ).first()
                if city_normalized_to_delete:
                    session.delete(city_normalized_to_delete)
                    print(f"  Deleted CityNormalized for '{city_name}' (ID: {city_normalized_to_delete.id})")
        
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
            ("CityMapping 1 (Portland) with float lat/lng and cityNormalizedId", test3_pass),
            ("CityMapping 2 (Seattle) with float lat/lng and cityNormalizedId", test4_pass),
            ("Both mappings created (2+ total)", test5_pass),
            ("CityNormalized records exist and mappings link correctly", test6_pass),
        ]
        
        passed = sum(1 for _, result in all_tests if result)
        total = len(all_tests)
        
        for test_name, result in all_tests:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status}: {test_name}")
        
        print(f"\nTotal: {passed}/{total} tests passed")
        
        if passed == total:
            print("\n🎉 All tests passed! Float lat/lng storage working correctly.")
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
    sys.exit(test_concert_with_us_cities())
