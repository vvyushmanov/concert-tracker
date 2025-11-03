#!/usr/bin/env python3
"""
Helper script to add/update countries via API
Used by /api/settings/countries endpoint
"""

import sys
import json
from datetime import datetime
from sqlalchemy.orm import sessionmaker
from db_config import get_engine
from db_models import Country
from country_helper import get_or_create_country, resolve_country_info, lookup_country_by_code

def add_or_update_country(input_value: str, active: bool = True) -> dict:
    """
    Add or update a country by name or code
    
    Args:
        input_value: Country name or code
        active: Whether to mark as active
        
    Returns:
        Dict with success status and country info
    """
    try:
        engine = get_engine()
        Session = sessionmaker(bind=engine)
        session = Session()
        
        # Determine if input is a country code (2 chars) or country name
        input_clean = input_value.strip()
        
        if len(input_clean) <= 2 and input_clean.isalpha():
            # Looks like a country code
            country_code = input_clean.lower()
            
            # Try to find existing country by code
            existing_country = session.query(Country).filter_by(code=country_code).first()
            
            if existing_country:
                # Update existing country
                existing_country.active = active
                existing_country.updatedAt = int(datetime.utcnow().timestamp())
                session.commit()
                
                return {
                    'success': True,
                    'country': {
                        'id': existing_country.id,
                        'name': existing_country.name,
                        'code': existing_country.code,
                        'active': existing_country.active
                    },
                    'message': f'Updated {existing_country.name} ({existing_country.code}) - Active: {active}'
                }
            else:
                # Try to resolve country name from code using API
                api_result = lookup_country_by_code(country_code)
                if api_result:
                    country_name, resolved_code = api_result
                    # Create new country
                    country = get_or_create_country(session, country_name, active=active, verbose=False)
                    country.updatedAt = int(datetime.utcnow().timestamp())
                    session.commit()
                    
                    return {
                        'success': True,
                        'country': {
                            'id': country.id,
                            'name': country.name,
                            'code': country.code,
                            'active': country.active
                        },
                        'message': f'Created {country.name} ({country.code}) - Active: {active}'
                    }
                else:
                    return {
                        'success': False,
                        'error': f'Could not resolve country code: {country_code}'
                    }
        else:
            # Treat as country name
            country_name = input_clean
            
            # Try to find existing country by name
            existing_country = session.query(Country).filter_by(name=country_name).first()
            
            if existing_country:
                # Update existing country
                existing_country.active = active
                existing_country.updatedAt = int(datetime.utcnow().timestamp())
                session.commit()
                
                return {
                    'success': True,
                    'country': {
                        'id': existing_country.id,
                        'name': existing_country.name,
                        'code': existing_country.code,
                        'active': existing_country.active
                    },
                    'message': f'Updated {existing_country.name} ({existing_country.code}) - Active: {active}'
                }
            else:
                # Create new country using country_helper
                country = get_or_create_country(session, country_name, active=active, verbose=False)
                country.updatedAt = int(datetime.utcnow().timestamp())
                session.commit()
                
                return {
                    'success': True,
                    'country': {
                        'id': country.id,
                        'name': country.name,
                        'code': country.code,
                        'active': country.active
                    },
                    'message': f'Created {country.name} ({country.code}) - Active: {active}'
                }
                
    except Exception as e:
        return {
            'success': False,
            'error': f'Database error: {str(e)}'
        }
    finally:
        if 'session' in locals():
            session.close()

def main():
    """Main function for command line usage"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python add_country.py <country_name_or_code> [active]'
        }))
        sys.exit(1)
    
    input_value = sys.argv[1]
    active = True
    
    if len(sys.argv) >= 3:
        active = sys.argv[2].lower() in ('true', '1', 'yes', 'on')
    
    result = add_or_update_country(input_value, active)
    print(json.dumps(result))
    
    sys.exit(0 if result['success'] else 1)

if __name__ == '__main__':
    main()
