#!/usr/bin/env python3
import requests
import json
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Adjustable parameters
API_KEY = os.getenv("LASTFM_API_KEY")
USER = "Megalox2"
METHOD = "user.gettopartists"
LIMIT = 400
FORMAT = "json"

def fetch_lastfm_data(method=METHOD, api_key=API_KEY, user=USER, limit=LIMIT, format=FORMAT):
    """Fetch data from Last.fm API"""
    url = "http://ws.audioscrobbler.com/2.0/"
    
    params = {
        "method": method,
        "api_key": api_key,
        "user": user,
        "format": format,
        "limit": limit
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    
    return response.json()

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

if __name__ == "__main__":
    data = fetch_lastfm_data()
    print_csv(data)
