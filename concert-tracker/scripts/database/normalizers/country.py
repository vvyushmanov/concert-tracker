#!/usr/bin/env python3
"""
Helper functions for Country table operations
Used during migration and by parser to handle country lookups and creation
Includes REST Countries API fallback for automatic country code resolution
"""

import requests
from datetime import datetime, timezone
from typing import Optional, Tuple
from database.models import Country

# Country name to ISO code mapping
COUNTRY_NAME_TO_CODE = {
    'Turkey': 'tr',
    'France': 'fr',
    'Germany': 'de',
    'United States': 'us',
    'United Kingdom': 'gb',
    'Spain': 'es',
    'Italy': 'it',
    'Netherlands': 'nl',
    'Belgium': 'be',
    'Switzerland': 'ch',
    'Austria': 'at',
    'Poland': 'pl',
    'Czech Republic': 'cz',
    'Sweden': 'se',
    'Norway': 'no',
    'Denmark': 'dk',
    'Finland': 'fi',
    'Portugal': 'pt',
    'Greece': 'gr',
    'Hungary': 'hu',
    'Romania': 'ro',
    'Bulgaria': 'bg',
    'Croatia': 'hr',
    'Serbia': 'rs',
    'Slovenia': 'si',
    'Slovakia': 'sk',
    'Ireland': 'ie',
    'Luxembourg': 'lu',
    'Canada': 'ca',
    'Mexico': 'mx',
    'Brazil': 'br',
    'Argentina': 'ar',
    'Chile': 'cl',
    'Australia': 'au',
    'New Zealand': 'nz',
    'Japan': 'jp',
    'South Korea': 'kr',
    'China': 'cn',
    'India': 'in',
    'Russia': 'ru',
    'Ukraine': 'ua',
    'Israel': 'il',
    'South Africa': 'za',
}


def lookup_country_by_name(country_name: str) -> Optional[Tuple[str, str]]:
    """
    Look up country code using REST Countries API by name
    
    Args:
        country_name: Full country name (e.g., "Turkey", "France")
        
    Returns:
        Tuple of (name, code) if found, None otherwise
    """
    try:
        # Use fullText=true for exact match
        url = f"https://restcountries.com/v3.1/name/{country_name}?fullText=true"
        response = requests.get(url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                country_data = data[0]  # Take first match
                name = country_data.get('name', {}).get('common', country_name)
                code = country_data.get('cca2', '').lower()  # ISO 3166-1 alpha-2
                
                if code:
                    return (name, code)
    except Exception as e:
        # Silently fail - we'll use fallback
        pass
    
    return None


def lookup_country_by_code(country_code: str) -> Optional[Tuple[str, str]]:
    """
    Look up country name using REST Countries API by code
    
    Args:
        country_code: ISO country code (e.g., "tr", "fr")
        
    Returns:
        Tuple of (name, code) if found, None otherwise
    """
    try:
        url = f"https://restcountries.com/v3.1/alpha/{country_code}"
        response = requests.get(url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                country_data = data[0]
                name = country_data.get('name', {}).get('common', '')
                code = country_data.get('cca2', '').lower()  # ISO 3166-1 alpha-2
                
                if name and code:
                    return (name, code)
    except Exception as e:
        # Silently fail - we'll use fallback
        pass
    
    return None


def resolve_country_info(country_name: str) -> Tuple[str, str]:
    """
    Resolve country name and code using multiple strategies:
    1. Check hardcoded mapping
    2. Try REST Countries API by name
    3. Fallback to 'xx' code
    
    Args:
        country_name: Full country name
        
    Returns:
        Tuple of (name, code)
    """
    # Strategy 1: Check hardcoded mapping
    if country_name in COUNTRY_NAME_TO_CODE:
        return (country_name, COUNTRY_NAME_TO_CODE[country_name])
    
    # Strategy 2: Try REST Countries API
    api_result = lookup_country_by_name(country_name)
    if api_result:
        return api_result
    
    # Strategy 3: Fallback to unknown
    return (country_name, 'xx')


def get_or_create_country(session, country_name: str, verbose: bool = False) -> Country:
    """
    Get existing country or create new one with automatic code resolution
    
    Uses multiple strategies to resolve country code:
    1. Check database for existing country
    2. Use hardcoded mapping
    3. Query REST Countries API
    4. Fallback to 'xx' for unknown
    
    Args:
        session: SQLAlchemy session
        country_name: Full country name (e.g., "Turkey", "France")
        verbose: If True, print resolution details
        
    Returns:
        Country object or None if country_name is empty
    """
    if not country_name:
        return None
    
    # Try to find existing country by name
    country = session.query(Country).filter_by(name=country_name).first()
    
    if country:
        if verbose:
            print(f"[Country] Found existing: {country.name} ({country.code})")
        return country
    
    # Resolve country name and code using multiple strategies
    resolved_name, country_code = resolve_country_info(country_name)
    
    if verbose:
        if country_code != 'xx':
            print(f"[Country] Resolved '{country_name}' -> {resolved_name} ({country_code})")
        else:
            print(f"[Country] Unknown country '{country_name}', using code 'xx'")
    
    now = int(datetime.now(timezone.utc).timestamp())
    
    # Check if code already exists (handle duplicates)
    existing_code = session.query(Country).filter_by(code=country_code).first()
    if existing_code and country_code != 'xx':
        # Append counter to make unique
        counter = 1
        while session.query(Country).filter_by(code=f"{country_code}_{counter}").first():
            counter += 1
        original_code = country_code
        country_code = f"{country_code}_{counter}"
        if verbose:
            print(f"[Country] Code '{original_code}' already exists, using '{country_code}'")
    
    # Create new country
    country = Country(
        name=resolved_name,  # Use resolved name (may be normalized by API)
        code=country_code,
        createdAt=now,
        updatedAt=now
    )
    
    session.add(country)
    session.flush()  # Get the ID immediately
    
    if verbose:
        print(f"[Country] Created: {country.name} ({country.code}) with ID {country.id}")
    
    return country
