"""
HTML extraction utilities for concert data

Extracts structured data from concerts-metal.com HTML pages.
"""

from typing import List, Dict, Set, Optional
from bs4 import BeautifulSoup
from urllib.parse import urljoin


class ConcertHTMLExtractor:
    """Extracts concert data from HTML using BeautifulSoup"""
    
    def __init__(self, base_url: str = "https://en.concerts-metal.com"):
        """Initialize HTML extractor
        
        Args:
            base_url: Base URL for resolving relative links
        """
        self.base_url = base_url
    
    def extract_venue_info(self, event_div) -> Dict[str, Optional[str]]:
        """Extract venue information from event div
        
        Args:
            event_div: BeautifulSoup div element containing event data
            
        Returns:
            Dict with venue, city, country, postal_code
        """
        venue_info = {
            'venue': None,
            'city': None,
            'country': None,
            'postal_code': None
        }
        
        location = event_div.find('div', itemprop='location')
        if location:
            venue_meta = location.find('meta', itemprop='name')
            if venue_meta:
                venue_info['venue'] = venue_meta.get('content')
            
            address = location.find('div', itemprop='address')
            if address:
                city_meta = address.find('meta', itemprop='addressLocality')
                country_meta = address.find('meta', itemprop='addressCountry')
                postal_meta = address.find('meta', itemprop='postalCode')
                
                if city_meta:
                    venue_info['city'] = city_meta.get('content')
                if country_meta:
                    venue_info['country'] = country_meta.get('content')
                if postal_meta:
                    venue_info['postal_code'] = postal_meta.get('content')
        
        return venue_info
    
    def extract_performers(self, event_div) -> List[str]:
        """Extract all performers from event
        
        Args:
            event_div: BeautifulSoup div element containing event data
            
        Returns:
            List of performer names
        """
        performers = []
        performer_divs = event_div.find_all('div', itemprop='performer')
        for performer in performer_divs:
            name_meta = performer.find('meta', itemprop='name')
            if name_meta:
                performers.append(name_meta.get('content'))
        return performers
    
    def extract_event_details(self, event_div) -> Dict:
        """Extract all details from a single event div
        
        Args:
            event_div: BeautifulSoup div element containing event data
            
        Returns:
            Dict with all event details
        """
        event = {
            'event_name': None,
            'event_url': None,
            'date_start': None,
            'date_end': None,
            'venue': None,
            'city': None,
            'country': None,
            'postal_code': None,
            'performers': [],
            'image_url': None,
            'organizer': None,
            'organizer_url': None,
            'ticket_links': []
        }
        
        # Event name - find the meta tag that's NOT inside the location div
        all_name_metas = event_div.find_all('meta', itemprop='name')
        for name_meta in all_name_metas:
            parent_location = name_meta.find_parent('div', itemprop='location')
            if not parent_location:
                event['event_name'] = name_meta.get('content')
                break
        
        # Event URL
        url_link = event_div.find('a', itemprop='url')
        if url_link:
            event['event_url'] = url_link.get('href')
            if event['event_url'] and not event['event_url'].startswith('http'):
                event['event_url'] = urljoin(self.base_url, event['event_url'])
        
        # Dates
        start_date = event_div.find('meta', itemprop='startDate')
        end_date = event_div.find('meta', itemprop='endDate')
        if start_date:
            event['date_start'] = start_date.get('content')
        if end_date:
            event['date_end'] = end_date.get('content')
        
        # Venue info
        venue_info = self.extract_venue_info(event_div)
        event.update(venue_info)
        
        # Performers
        event['performers'] = self.extract_performers(event_div)
        
        # Image
        image_meta = event_div.find('meta', itemprop='image')
        if image_meta:
            event['image_url'] = image_meta.get('content')
        
        # Organizer
        organizer_div = event_div.find('div', itemprop='organizer')
        if organizer_div:
            org_name = organizer_div.find('meta', itemprop='name')
            org_url = organizer_div.find('meta', itemprop='url')
            if org_name:
                event['organizer'] = org_name.get('content')
            if org_url:
                event['organizer_url'] = org_url.get('content')
        
        # Ticket links
        ticket_offers = event_div.find_all('span', itemprop='offers')
        for offer in ticket_offers:
            link = offer.find('a', itemprop='url')
            if link:
                ticket_info = {
                    'vendor': link.get_text(strip=True),
                    'url': link.get('href')
                }
                price_meta = offer.find('meta', itemprop='price')
                currency_meta = offer.find('meta', itemprop='priceCurrency')
                if price_meta and currency_meta:
                    ticket_info['price'] = f"{price_meta.get('content')} {currency_meta.get('content')}"
                
                event['ticket_links'].append(ticket_info)
        
        return event
    
    def extract_events_from_page(self, soup: BeautifulSoup) -> List[Dict]:
        """Extract all events from a page
        
        Args:
            soup: BeautifulSoup object of the page
            
        Returns:
            List of event dicts
        """
        events = []
        event_divs = soup.find_all('div', itemtype='https://schema.org/MusicEvent')
        
        for event_div in event_divs:
            event = self.extract_event_details(event_div)
            events.append(event)
        
        return events
