#!/usr/bin/env python3
import requests
import json
import sys
import os
import time
import urllib.parse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Adjustable parameters
LASTFM_API_KEY = os.getenv("LASTFM_API_KEY")
BANDSINTOWN_API_KEY = os.getenv("BANDSINTOWN_API_KEY")
USER = "Megalox2"
METHOD = "user.gettopartists"
LIMIT = 400
FORMAT = "json"
RATE_LIMIT_DELAY = 0.5  # seconds between API requests

def fetch_lastfm_data(method=METHOD, api_key=LASTFM_API_KEY, user=USER, limit=LIMIT, format=FORMAT, period=None):
    """Fetch data from Last.fm API"""
    url = "http://ws.audioscrobbler.com/2.0/"
    
    params = {
        "method": method,
        "api_key": api_key,
        "user": user,
        "format": format,
        "limit": limit
    }
    
    if period:
        params["period"] = period
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    
    return response.json()

def fetch_bandsintown_data(artist_name, app_id=BANDSINTOWN_API_KEY):
    """Fetch concert data from Bandsintown API"""
    # URL encode the artist name
    encoded_name = urllib.parse.quote(artist_name)
    url = f"https://rest.bandsintown.com/artists/{encoded_name}"
    
    params = {
        "app_id": app_id
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        
        # Only process if status code is 200
        if response.status_code != 200:
            return None
        
        data = response.json()
        
        # Verify it's a dict (sometimes API returns strings on error)
        if not isinstance(data, dict):
            return None
            
        return data
    except Exception as e:
        # Return None if artist not found or error occurs
        return None

def print_csv(data):
    """Print artists data as CSV"""
    artists = data.get("topartists", {}).get("artist", [])
    
    # Print header
    print("Rank,Name,Playcount")
    
    # Print rows
    for artist in artists:
        rank = artist.get("@attr", {}).get("rank", "")
        name = artist.get("name", "")
        playcount = artist.get("playcount", "")
        print(f"{rank},{name},{playcount}")

def fetch_concerts_for_artists(artists, output_file="concerts.txt", recent_artists_names=None, overall_playcounts=None):
    """Fetch concert information for a list of artists and write to file in real-time"""
    results = []
    total = len(artists)
    recent_artists_names = recent_artists_names or set()
    overall_playcounts = overall_playcounts or {}
    
    # Open output file and write header
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("="*120 + "\n")
        f.write(f"{'Artist Name':<45} {'Playcount':<15} {'Upcoming Shows':<15} {'URL'}\n")
        f.write("="*120 + "\n")
        f.flush()
        
        for idx, artist in enumerate(artists, 1):
            name = artist.get("name", "")
            playcount = int(artist.get("playcount", 0))
            
            # Filter by overall playcount (not 12-month playcount)
            # Get overall playcount if available, otherwise use current playcount
            overall_playcount = overall_playcounts.get(name, playcount)
            if overall_playcount < 40:
                continue
            
            # Show progress
            print(f"Fetching concert data... {idx}/{total} ({name})", file=sys.stderr)
            
            # Fetch Bandsintown data
            concert_data = fetch_bandsintown_data(name)
            
            # Skip if no valid data returned
            if concert_data is None:
                time.sleep(0.3)  # Longer delay on errors
                continue
            
            upcoming_events = concert_data.get("upcoming_event_count", 0)
            url = concert_data.get("url", "")
            
            # Only include artists with upcoming shows
            if upcoming_events > 0:
                artist_data = {
                    "name": name,
                    "playcount": playcount,
                    "upcoming_events": upcoming_events,
                    "url": url,
                    "is_recent": name in recent_artists_names
                }
                results.append(artist_data)
                
                # Write to file immediately (sorted by playcount so far)
                # Clear and rewrite the table section
                f.seek(0)
                f.write("="*120 + "\n")
                f.write("ARTISTS LISTENED TO IN LAST 12 MONTHS\n")
                f.write("="*120 + "\n")
                f.write(f"{'Artist Name':<45} {'Playcount':<15} {'Upcoming Shows':<15} {'URL'}\n")
                f.write("="*120 + "\n")
                
                # Sort current results by playcount and write - recent artists first
                recent_results = [r for r in results if r["is_recent"]]
                older_results = [r for r in results if not r["is_recent"]]
                
                recent_sorted = sorted(recent_results, key=lambda x: x["playcount"], reverse=True)
                older_sorted = sorted(older_results, key=lambda x: x["playcount"], reverse=True)
                
                for artist_info in recent_sorted:
                    artist_name = artist_info["name"][:44]
                    pc = artist_info["playcount"]
                    upcoming = artist_info["upcoming_events"]
                    artist_url = artist_info["url"]
                    f.write(f"{artist_name:<45} {pc:<15} {upcoming:<15} {artist_url}\n")
                
                if older_results:
                    f.write("\n" + "="*120 + "\n")
                    f.write("ARTISTS NOT LISTENED TO IN LAST 12 MONTHS (BUT IN OVERALL TOP 400)\n")
                    f.write("="*120 + "\n")
                    f.write(f"{'Artist Name':<45} {'Playcount':<15} {'Upcoming Shows':<15} {'URL'}\n")
                    f.write("="*120 + "\n")
                    
                    for artist_info in older_sorted:
                        artist_name = artist_info["name"][:44]
                        pc = artist_info["playcount"]
                        upcoming = artist_info["upcoming_events"]
                        artist_url = artist_info["url"]
                        f.write(f"{artist_name:<45} {pc:<15} {upcoming:<15} {artist_url}\n")
                
                f.write("="*120 + "\n")
                f.write(f"\nTotal artists with upcoming shows: {len(results)} (Recent: {len(recent_results)}, Older: {len(older_results)})\n")
                f.write(f"Progress: {idx}/{total} artists checked\n")
                f.flush()
            
            # Rate limiting: 0.5 seconds between requests to avoid blocking
            time.sleep(0.5)
    
    return results

def print_concert_table(results, output_file="concerts.txt"):
    """Print concert results summary"""
    # Sort by playcount (descending)
    sorted_results = sorted(results, key=lambda x: x["playcount"], reverse=True)
    
    print("\n" + "="*100, file=sys.stderr)
    print(f"Results written to: {output_file}", file=sys.stderr)
    print(f"Total artists with upcoming shows: {len(sorted_results)}", file=sys.stderr)
    print("="*100, file=sys.stderr)

if __name__ == "__main__":
    output_file = "concerts.txt"
    
    # Fetch top artists from Last.fm (overall)
    print("Fetching top 400 artists (overall) from Last.fm...", file=sys.stderr)
    data_overall = fetch_lastfm_data()
    artists_overall = data_overall.get("topartists", {}).get("artist", [])
    
    # Fetch top artists from Last.fm (12 months)
    print("Fetching top 400 artists (last 12 months) from Last.fm...", file=sys.stderr)
    data_12month = fetch_lastfm_data(period="12month")
    artists_12month = data_12month.get("topartists", {}).get("artist", [])
    
    # Get set of recent artist names for marking
    recent_artists_names = {artist.get("name") for artist in artists_12month}
    
    # Create a dict of overall playcounts for filtering
    overall_playcounts = {artist.get("name"): int(artist.get("playcount", 0)) for artist in artists_overall}
    
    # Merge artists lists without duplicates
    # For recent artists (in 12-month list): use 12-month playcount
    # For older artists (only in overall list): use overall playcount
    artists_dict = {}
    
    # First add 12-month artists with their 12-month playcount
    for artist in artists_12month:
        name = artist.get("name")
        artists_dict[name] = artist
    
    # Then add overall artists that aren't in 12-month list
    for artist in artists_overall:
        name = artist.get("name")
        if name not in artists_dict:
            artists_dict[name] = artist
    
    all_artists = list(artists_dict.values())
    
    print(f"Total unique artists to check: {len(all_artists)}", file=sys.stderr)
    print(f"Artists from last 12 months: {len(recent_artists_names)}", file=sys.stderr)
    print(f"Results will be written to: {output_file}", file=sys.stderr)
    print(f"You can view the file while the script is running!\n", file=sys.stderr)
    
    # Fetch concert information for each artist
    results = fetch_concerts_for_artists(all_artists, output_file, recent_artists_names, overall_playcounts)
    
    # Print summary
    print_concert_table(results, output_file)
