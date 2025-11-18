#!/usr/bin/env python3
"""
Comprehensive test suite for Artist-Concert many-to-many relationship

Tests all scenarios:
1. New concert with single artist
2. New concert with multiple artists
3. Existing concert re-scanned by same user
4. Existing concert scanned by different user
5. Primary artist determination
6. Artist creation for additional performers
7. UserArtist and UserConcert link creation
"""

import sys
import os
from datetime import datetime, timezone
from sqlalchemy import func

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_session
from database.models import Artist, Concert, ArtistConcert, UserArtist, UserConcert, User, Country
from database.writer import ConcertDatabaseWriter
from utils import get_logger, setup_logging

logger = get_logger(__name__)
setup_logging(verbose=True)


class TestArtistConcertLinks:
    """Test suite for artist-concert many-to-many relationships"""
    
    def __init__(self, verbose=False):
        self.session = get_session()
        self.test_results = []
        self.verbose = verbose
        self.setup_test_users()
    
    def setup_test_users(self):
        """Create test users if they don't exist"""
        # Use existing admin user for tests
        self.user1 = self.session.query(User).filter_by(username='admin').first()
        if not self.user1:
            print("❌ Admin user not found. Please create admin user first.")
            sys.exit(1)
        
        # Try to find or use second existing user
        all_users = self.session.query(User).filter(User.username != 'admin').all()
        if len(all_users) > 0:
            self.user2 = all_users[0]
        else:
            # Use admin as second user for testing
            self.user2 = self.user1
            print("⚠️  Using same user for both test scenarios (only one user exists)")
        
        # Ensure test country exists
        test_country = self.session.query(Country).filter_by(code='us').first()
        if not test_country:
            test_country = Country(
                name='United States',
                code='us',
                createdAt=int(datetime.now(timezone.utc).timestamp()),
                updatedAt=int(datetime.now(timezone.utc).timestamp())
            )
            self.session.add(test_country)
            self.session.commit()
            print("✅ Created test country: United States")
        
        print(f"✅ Test users ready: {self.user1.username} (ID: {self.user1.id}), {self.user2.username} (ID: {self.user2.id})")
    
    def cleanup_test_data(self):
        """Remove test concerts and artists"""
        print("\n🧹 Cleaning up test data...")
        
        # Delete test concerts (cascade will handle ArtistConcert and UserConcert)
        test_urls = [
            'https://test.com/concert1',
            'https://test.com/concert2',
            'https://test.com/concert3',
            'https://test.com/concert4',
            'https://test.com/concert5',
            'https://test.com/concert6'
        ]
        
        for url in test_urls:
            concert = self.session.query(Concert).filter_by(eventUrl=url).first()
            if concert:
                self.session.delete(concert)
        
        # Delete test artists
        test_artists = ['Test Artist A', 'Test Artist B', 'Test Artist C', 'Test Artist D', 'Test Artist E']
        for name in test_artists:
            artist = self.session.query(Artist).filter_by(name=name).first()
            if artist:
                self.session.delete(artist)
        
        self.session.commit()
        print("✅ Cleanup complete")
    
    def assert_equal(self, actual, expected, message):
        """Assert equality and track result"""
        if actual == expected:
            self.test_results.append(('PASS', message))
            print(f"  ✅ {message}")
            return True
        else:
            self.test_results.append(('FAIL', f"{message} - Expected: {expected}, Got: {actual}"))
            print(f"  ❌ {message} - Expected: {expected}, Got: {actual}")
            return False
    
    def assert_true(self, condition, message):
        """Assert condition is true"""
        if condition:
            self.test_results.append(('PASS', message))
            print(f"  ✅ {message}")
            return True
        else:
            self.test_results.append(('FAIL', message))
            print(f"  ❌ {message}")
            return False
    
    def refresh_session(self):
        """Close and recreate session to see committed changes"""
        # Store user IDs before closing
        user1_id = self.user1.id
        user2_id = self.user2.id
        
        self.session.close()
        self.session = get_session()
        
        # Reload user objects in new session
        self.user1 = self.session.query(User).filter_by(id=user1_id).first()
        self.user2 = self.session.query(User).filter_by(id=user2_id).first()
    
    def test_1_new_concert_single_artist(self):
        """Test 1: New concert with single matched artist"""
        print("\n" + "="*80)
        print("TEST 1: New concert with single matched artist")
        print("="*80)
        
        # Use a new session for the writer to ensure clean state
        writer = ConcertDatabaseWriter(user_id=self.user1.id, debug=self.verbose)
        
        concert_data = {
            'event_name': 'Test Concert 1',
            'event_url': 'https://test.com/concert1',
            'date_start': '2025-06-15',
            'date_end': '2025-06-15',
            'venue': 'Test Venue',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Unknown Artist'],
            'matched_artists': ['Test Artist A'],  # Only A matches Last.fm
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist A': 100},
            artist_playcounts_12month={'Test Artist A': 50},
            recent_artists={'Test Artist A'},
            artist_mbids={'Test Artist A': 'test-mbid-a'}
        )
        writer.session.close()
        self.refresh_session()
        
        # Verify concert created
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert1').first()
        self.assert_true(concert is not None, "Concert created")
        
        if concert:
            # Verify Artist created
            artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
            self.assert_true(artist_a is not None, "Artist A created")
            self.assert_equal(artist_a.mbid, 'test-mbid-a', "Artist A has correct MBID")
            
            # Verify ArtistConcert link
            links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
            self.assert_equal(len(links), 1, "One ArtistConcert link created")
            
            if len(links) == 1:
                self.assert_equal(links[0].artistId, artist_a.id, "Link points to Artist A")
                self.assert_true(links[0].isPrimary, "Artist A is marked as primary")
            
            # Verify UserArtist created
            user_artist = self.session.query(UserArtist).filter_by(
                userId=self.user1.id,
                artistId=artist_a.id
            ).first()
            self.assert_true(user_artist is not None, "UserArtist created")
            if user_artist:
                self.assert_equal(user_artist.playcount, 100, "UserArtist has correct playcount")
                self.assert_equal(user_artist.playcount12month, 50, "UserArtist has correct 12-month playcount")
            
            # Verify UserConcert created
            user_concert = self.session.query(UserConcert).filter_by(
                userId=self.user1.id,
                concertId=concert.id
            ).first()
            self.assert_true(user_concert is not None, "UserConcert link created")
    
    def test_2_new_concert_multiple_artists(self):
        """Test 2: New concert with multiple matched artists"""
        print("\n" + "="*80)
        print("TEST 2: New concert with multiple matched artists")
        print("="*80)
        
        writer = ConcertDatabaseWriter(user_id=self.user1.id, debug=self.verbose)
        
        concert_data = {
            'event_name': 'Test Concert 2',
            'event_url': 'https://test.com/concert2',
            'date_start': '2025-07-20',
            'date_end': '2025-07-20',
            'venue': 'Test Venue 2',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist C'],
            'matched_artists': ['Test Artist A', 'Test Artist B', 'Test Artist C'],
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist A': 100, 'Test Artist B': 200, 'Test Artist C': 50},
            artist_playcounts_12month={'Test Artist A': 50, 'Test Artist B': 100, 'Test Artist C': 25},
            artist_mbids={'Test Artist A': 'test-mbid-a', 'Test Artist B': 'test-mbid-b', 'Test Artist C': 'test-mbid-c'}
        )
        writer.session.close()
        self.refresh_session()
        
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert2').first()
        self.assert_true(concert is not None, "Concert created")
        
        if concert:
            # Verify all artists created
            artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
            artist_b = self.session.query(Artist).filter_by(name='Test Artist B').first()
            artist_c = self.session.query(Artist).filter_by(name='Test Artist C').first()
            
            self.assert_true(artist_a is not None, "Artist A exists")
            self.assert_true(artist_b is not None, "Artist B created")
            self.assert_true(artist_c is not None, "Artist C created")
            
            # Verify ArtistConcert links
            links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
            self.assert_equal(len(links), 3, "Three ArtistConcert links created")
            
            # Check primary artist (should be first in list)
            primary_link = self.session.query(ArtistConcert).filter_by(
                concertId=concert.id,
                isPrimary=True
            ).first()
            self.assert_true(primary_link is not None, "Primary link exists")
            if primary_link:
                self.assert_equal(primary_link.artistId, artist_a.id, "Artist A is primary (first in list)")
            
            # Check additional artists
            additional_links = self.session.query(ArtistConcert).filter_by(
                concertId=concert.id,
                isPrimary=False
            ).all()
            self.assert_equal(len(additional_links), 2, "Two additional artist links")
            
            additional_artist_ids = {link.artistId for link in additional_links}
            self.assert_true(artist_b.id in additional_artist_ids, "Artist B is additional")
            self.assert_true(artist_c.id in additional_artist_ids, "Artist C is additional")
    
    def test_3_rescan_same_user(self):
        """Test 3: Same user re-scans existing concert"""
        print("\n" + "="*80)
        print("TEST 3: Same user re-scans existing concert")
        print("="*80)
        
        writer = ConcertDatabaseWriter(user_id=self.user1.id, debug=self.verbose)
        
        # Get existing concert from test 2
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert2').first()
        initial_concert_count = self.session.query(func.count(Concert.id)).scalar()
        initial_link_count = self.session.query(func.count(ArtistConcert.id)).filter_by(concertId=concert.id).scalar()
        
        concert_data = {
            'event_name': 'Test Concert 2',
            'event_url': 'https://test.com/concert2',
            'date_start': '2025-07-20',
            'date_end': '2025-07-20',
            'venue': 'Test Venue 2',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist C'],
            'matched_artists': ['Test Artist A', 'Test Artist B', 'Test Artist C'],
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist A': 150, 'Test Artist B': 250, 'Test Artist C': 75},
            artist_playcounts_12month={'Test Artist A': 75, 'Test Artist B': 125, 'Test Artist C': 35},
            artist_mbids={'Test Artist A': 'test-mbid-a', 'Test Artist B': 'test-mbid-b', 'Test Artist C': 'test-mbid-c'}
        )
        writer.session.close()
        self.refresh_session()
        
        # Verify no duplicate concert
        final_concert_count = self.session.query(func.count(Concert.id)).scalar()
        self.assert_equal(final_concert_count, initial_concert_count, "No duplicate concert created")
        
        # Verify no duplicate links
        final_link_count = self.session.query(func.count(ArtistConcert.id)).filter_by(concertId=concert.id).scalar()
        self.assert_equal(final_link_count, initial_link_count, "No duplicate ArtistConcert links")
        
        # Verify UserArtist stats updated
        artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
        user_artist = self.session.query(UserArtist).filter_by(
            userId=self.user1.id,
            artistId=artist_a.id
        ).first()
        self.assert_equal(user_artist.playcount, 150, "UserArtist playcount updated")
        self.assert_equal(user_artist.playcount12month, 75, "UserArtist 12-month playcount updated")
    
    def test_4_different_user_scans_same_concert(self):
        """Test 4: Different user scans existing concert with different matched artists"""
        print("\n" + "="*80)
        print("TEST 4: Different user scans same concert with different matched artists")
        print("="*80)
        
        writer = ConcertDatabaseWriter(user_id=self.user2.id, debug=self.verbose)
        
        # User 2 only listens to Artist C (not A or B)
        concert_data = {
            'event_name': 'Test Concert 2',
            'event_url': 'https://test.com/concert2',
            'date_start': '2025-07-20',
            'date_end': '2025-07-20',
            'venue': 'Test Venue 2',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist C'],
            'matched_artists': ['Test Artist C'],  # User 2 only matches C
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist C': 300},
            artist_playcounts_12month={'Test Artist C': 150},
            artist_mbids={'Test Artist C': 'test-mbid-c'}
        )
        writer.session.close()
        self.refresh_session()
        
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert2').first()
        
        # Verify primary artist didn't change
        primary_link = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).first()
        artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
        self.assert_equal(primary_link.artistId, artist_a.id, "Primary artist still Artist A (first scan wins)")
        
        # Verify only ONE primary artist
        primary_count = self.session.query(func.count(ArtistConcert.id)).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).scalar()
        self.assert_equal(primary_count, 1, "Only one primary artist exists")
        
        # Verify Artist C link exists but is NOT primary
        artist_c = self.session.query(Artist).filter_by(name='Test Artist C').first()
        link_c = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            artistId=artist_c.id
        ).first()
        self.assert_true(link_c is not None, "Artist C link exists")
        self.assert_true(not link_c.isPrimary, "Artist C is NOT primary (was additional from first scan)")
        
        # Verify User 2's UserConcert link created
        user_concert = self.session.query(UserConcert).filter_by(
            userId=self.user2.id,
            concertId=concert.id
        ).first()
        self.assert_true(user_concert is not None, "User 2's UserConcert link created")
        
        # Verify User 2's UserArtist created for Artist C
        user_artist = self.session.query(UserArtist).filter_by(
            userId=self.user2.id,
            artistId=artist_c.id
        ).first()
        self.assert_true(user_artist is not None, "User 2's UserArtist created for Artist C")
        if user_artist:
            self.assert_equal(user_artist.playcount, 300, "User 2's playcount for Artist C")
    
    def test_5_new_artist_added_by_second_user(self):
        """Test 5: Second user adds a new artist to existing concert"""
        print("\n" + "="*80)
        print("TEST 5: Second user adds new artist to existing concert")
        print("="*80)
        
        # First, create a concert with User 1 (Artists A, B)
        writer1 = ConcertDatabaseWriter(user_id=self.user1.id, debug=False)
        
        concert_data = {
            'event_name': 'Test Concert 3',
            'event_url': 'https://test.com/concert3',
            'date_start': '2025-08-10',
            'date_end': '2025-08-10',
            'venue': 'Test Venue 3',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist D'],
            'matched_artists': ['Test Artist A', 'Test Artist B'],  # User 1 doesn't listen to D
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer1.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist A': 100, 'Test Artist B': 200},
            artist_playcounts_12month={'Test Artist A': 50, 'Test Artist B': 100},
            artist_mbids={'Test Artist A': 'test-mbid-a', 'Test Artist B': 'test-mbid-b'}
        )
        writer1.session.close()
        self.refresh_session()
        
        # Verify initial state
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert3').first()
        initial_links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
        self.assert_equal(len(initial_links), 2, "Initially 2 artist links (A, B)")
        
        # Now User 2 scans and matches Artist D
        writer2 = ConcertDatabaseWriter(user_id=self.user2.id, debug=self.verbose)
        
        concert_data['matched_artists'] = ['Test Artist D']  # User 2 only listens to D
        
        writer2.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist D': 500},
            artist_playcounts_12month={'Test Artist D': 250},
            artist_mbids={'Test Artist D': 'test-mbid-d'}
        )
        writer2.session.close()
        self.refresh_session()
        
        # Need to reload concert object after session refresh
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert3').first()
        
        # Verify Artist D was created
        artist_d = self.session.query(Artist).filter_by(name='Test Artist D').first()
        self.assert_true(artist_d is not None, "Artist D created by User 2's scan")
        
        # Verify Artist D link added
        final_links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
        self.assert_equal(len(final_links), 3, "Now 3 artist links (A, B, D)")
        
        # Verify Artist D is NOT primary
        link_d = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            artistId=artist_d.id
        ).first()
        self.assert_true(link_d is not None, "Artist D link exists")
        self.assert_true(not link_d.isPrimary, "Artist D is NOT primary")
        
        # Verify primary is still Artist A
        primary_link = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).first()
        artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
        self.assert_equal(primary_link.artistId, artist_a.id, "Primary still Artist A")
    
    def test_6_new_artist_discovered_on_rescan(self):
        """Test 6: New artist match discovered when re-scanning existing concert"""
        print("\n" + "="*80)
        print("TEST 6: New artist discovered on re-scan creates UserArtist")
        print("="*80)
        
        # First scan: User 1 creates concert with Artists A and B
        writer1 = ConcertDatabaseWriter(user_id=self.user1.id, debug=self.verbose)
        
        concert_data = {
            'event_name': 'Test Concert 4',
            'event_url': 'https://test.com/concert4',
            'date_start': '2025-09-15',
            'date_end': '2025-09-15',
            'venue': 'Test Venue 4',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist E'],
            'matched_artists': ['Test Artist A', 'Test Artist B'],  # E not matched yet
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer1.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist A': 100, 'Test Artist B': 200},
            artist_playcounts_12month={'Test Artist A': 50, 'Test Artist B': 100},
            artist_mbids={'Test Artist A': 'test-mbid-a', 'Test Artist B': 'test-mbid-b'}
        )
        writer1.session.close()
        self.refresh_session()
        
        # Verify initial state
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert4').first()
        self.assert_true(concert is not None, "Concert created")
        
        initial_links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
        self.assert_equal(len(initial_links), 2, "Initially 2 artist links (A, B)")
        
        # Verify Artist E does NOT exist yet
        artist_e = self.session.query(Artist).filter_by(name='Test Artist E').first()
        self.assert_true(artist_e is None, "Artist E does not exist initially")
        
        # Re-scan: User 1 now matches Artist E (started listening to them)
        writer2 = ConcertDatabaseWriter(user_id=self.user1.id, debug=self.verbose)
        
        concert_data['matched_artists'] = ['Test Artist A', 'Test Artist B', 'Test Artist E']  # E now matched!
        
        writer2.write_concerts(
            [concert_data],
            artist_playcounts={
                'Test Artist A': 100, 
                'Test Artist B': 200,
                'Test Artist E': 42  # NEW: User started listening to Artist E
            },
            artist_playcounts_12month={
                'Test Artist A': 50, 
                'Test Artist B': 100,
                'Test Artist E': 15
            },
            recent_artists={'Test Artist E'},  # E is recent
            artist_mbids={
                'Test Artist A': 'test-mbid-a', 
                'Test Artist B': 'test-mbid-b',
                'Test Artist E': 'test-mbid-e'
            }
        )
        writer2.session.close()
        self.refresh_session()
        
        # Reload concert
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert4').first()
        
        # Verify Artist E was created
        artist_e = self.session.query(Artist).filter_by(name='Test Artist E').first()
        self.assert_true(artist_e is not None, "Artist E created on re-scan")
        self.assert_equal(artist_e.mbid, 'test-mbid-e', "Artist E has correct MBID")
        
        # Verify Artist E link added
        final_links = self.session.query(ArtistConcert).filter_by(concertId=concert.id).all()
        self.assert_equal(len(final_links), 3, "Now 3 artist links (A, B, E)")
        
        # Verify Artist E link exists and is NOT primary
        link_e = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            artistId=artist_e.id
        ).first()
        self.assert_true(link_e is not None, "Artist E link exists")
        self.assert_true(not link_e.isPrimary, "Artist E is NOT primary")
        
        # CRITICAL: Verify UserArtist was created for Artist E
        user_artist_e = self.session.query(UserArtist).filter_by(
            userId=self.user1.id,
            artistId=artist_e.id
        ).first()
        self.assert_true(user_artist_e is not None, "UserArtist created for Artist E")
        
        if user_artist_e:
            self.assert_equal(user_artist_e.playcount, 42, "UserArtist E has correct playcount")
            self.assert_equal(user_artist_e.playcount12month, 15, "UserArtist E has correct 12-month playcount")
            self.assert_true(user_artist_e.recent, "UserArtist E marked as recent")
    
    def test_7_concert_artistid_not_changed(self):
        """Test 7: Verify primary artist doesn't change on re-scan (via ArtistConcert)"""
        print("\n" + "="*80)
        print("TEST 7: Primary artist remains stable across scans")
        print("="*80)
        
        # Get concert from test 3
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert3').first()
        artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
        
        # Check primary artist via ArtistConcert table (new approach)
        initial_primary = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).first()
        self.assert_equal(initial_primary.artistId, artist_a.id, "Initial primary artist is Artist A")
        
        # User 2 scans again with different primary artist in their list
        writer = ConcertDatabaseWriter(user_id=self.user2.id, debug=self.verbose)
        
        concert_data = {
            'event_name': 'Test Concert 3',
            'event_url': 'https://test.com/concert3',
            'date_start': '2025-08-10',
            'date_end': '2025-08-10',
            'venue': 'Test Venue 3',
            'city': 'Test City',
            'country': 'United States',
            'postal_code': '12345',
            'performers': ['Test Artist A', 'Test Artist B', 'Test Artist D'],
            'matched_artists': ['Test Artist D'],  # D would be "primary" for User 2
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        writer.write_concerts(
            [concert_data],
            artist_playcounts={'Test Artist D': 500},
            artist_playcounts_12month={'Test Artist D': 250},
            artist_mbids={'Test Artist D': 'test-mbid-d'}
        )
        writer.session.close()
        self.refresh_session()
        
        # Reload concert and artist objects in new session
        concert = self.session.query(Concert).filter_by(eventUrl='https://test.com/concert3').first()
        artist_a = self.session.query(Artist).filter_by(name='Test Artist A').first()
        
        # Verify primary artist didn't change (via ArtistConcert table)
        final_primary = self.session.query(ArtistConcert).filter_by(
            concertId=concert.id,
            isPrimary=True
        ).first()
        self.assert_equal(final_primary.artistId, initial_primary.artistId, "Primary artist unchanged (still Artist A)")
        self.assert_equal(final_primary.artistId, artist_a.id, "Primary artist still points to Artist A")
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        passed = sum(1 for result, _ in self.test_results if result == 'PASS')
        failed = sum(1 for result, _ in self.test_results if result == 'FAIL')
        total = len(self.test_results)
        
        print(f"Total tests: {total}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"Success rate: {(passed/total*100):.1f}%")
        
        if failed > 0:
            print("\nFailed tests:")
            for result, message in self.test_results:
                if result == 'FAIL':
                    print(f"  ❌ {message}")
        
        print("="*80)
        
        return failed == 0
    
    def run_all_tests(self):
        """Run all tests"""
        print("\n" + "="*80)
        print("ARTIST-CONCERT MANY-TO-MANY RELATIONSHIP TEST SUITE")
        print("="*80)
        
        try:
            self.cleanup_test_data()
            
            self.test_1_new_concert_single_artist()
            self.test_2_new_concert_multiple_artists()
            self.test_3_rescan_same_user()
            self.test_4_different_user_scans_same_concert()
            self.test_5_new_artist_added_by_second_user()
            self.test_6_new_artist_discovered_on_rescan()
            self.test_7_concert_artistid_not_changed()
            
            success = self.print_summary()
            
            # Cleanup after tests
            self.cleanup_test_data()
            
            return success
            
        except Exception as e:
            print(f"\n❌ Test suite failed with error: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            self.session.close()


def main():
    """Run test suite"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Test Artist-Concert many-to-many relationship implementation'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose debug output from database writer'
    )
    
    args = parser.parse_args()
    
    test_suite = TestArtistConcertLinks(verbose=args.verbose)
    success = test_suite.run_all_tests()
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
