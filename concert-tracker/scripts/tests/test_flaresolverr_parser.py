#!/usr/bin/env python3
"""
Integration test for FlareSolverr with real concert parsing
Tests parsing concerts from concerts-metal.com using FlareSolverr to bypass Cloudflare
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from .env file in project root
project_root = Path(__file__).parent.parent.parent.parent
dotenv_path = project_root / '.env'
load_dotenv(dotenv_path=dotenv_path)

from utils import get_logger, setup_logging
from services.http_client import HTTPClient, get_flaresolverr_config
from parsers.country_parser import CountryConcertParser
from parsers.html_extractor import ConcertHTMLExtractor
from bs4 import BeautifulSoup

logger = get_logger(__name__)


def test_parse_germany_concerts():
    """Parse first 5 pages of Germany concerts with FlareSolverr"""
    logger.info("=" * 60)
    logger.info("FlareSolverr Real Parser Integration Test")
    logger.info("=" * 60)

    # Check FlareSolverr availability
    flaresolverr_url, flaresolverr_enabled = get_flaresolverr_config()

    if not flaresolverr_enabled:
        logger.error("❌ FLARESOLVERR_URL not set in environment")
        logger.info("Please set FLARESOLVERR_URL in your .env file")
        return 1

    logger.info(f"✅ FlareSolverr configured at {flaresolverr_url}")
    logger.info(f"Target: Germany (de), first 5 pages")
    logger.info("")

    # Create parser with FlareSolverr-enabled HTTP client using context manager
    try:
        # Create standard parser
        parser_obj = CountryConcertParser(
            country_code="de",
            max_pages=5,
            delay=1.0,
            debug=True
        )

        # Replace http_client with FlareSolverr-enabled version
        parser_obj.http_client.close()
        parser_obj.http_client = HTTPClient(
            use_flaresolverr=True,
            timeout=30,
            use_system_ca=True
        )

        logger.info("Starting concert parsing...")
        logger.info("")

        all_concerts = []

        # Parse each page
        for page_num in range(1, 6):  # Pages 1-5
            logger.info(f"--- Page {page_num}/5 ---")

            # Get page URL
            page_url = parser_obj.get_page_url(page_num)
            logger.info(f"URL: {page_url}")

            # Fetch page
            soup = parser_obj.fetch_page(page_url)

            if not soup:
                logger.error(f"❌ Failed to fetch page {page_num}")
                continue

            # Extract concerts using the HTML extractor
            extractor = ConcertHTMLExtractor(base_url=parser_obj.base_url)
            concerts = extractor.extract_events_from_page(soup)

            logger.info(f"✅ Extracted {len(concerts)} concerts from page {page_num}")

            if concerts:
                # Show first concert as example
                first = concerts[0]
                logger.info(f"Example concert:")
                logger.info(f"  Event: {first.get('event_name', 'N/A')}")
                logger.info(f"  Date: {first.get('date_start', 'N/A')}")
                logger.info(f"  City: {first.get('city', 'N/A')}")
                logger.info(f"  Venue: {first.get('venue', 'N/A')}")
                logger.info(f"  Performers: {', '.join(first.get('performers', [])[:3])}")
                if len(first.get('performers', [])) > 3:
                    logger.info(f"    ... and {len(first.get('performers', [])) - 3} more")

            all_concerts.extend(concerts)
            logger.info("")

        # Summary
        logger.info("=" * 60)
        logger.info("Parsing Complete!")
        logger.info("=" * 60)
        logger.info(f"Total concerts extracted: {len(all_concerts)}")

        if all_concerts:
            # Count unique performers
            all_performers = set()
            for concert in all_concerts:
                all_performers.update(concert.get('performers', []))

            logger.info(f"Unique performers: {len(all_performers)}")

            # Count concerts by city
            cities = {}
            for concert in all_concerts:
                city = concert.get('city', 'Unknown')
                cities[city] = cities.get(city, 0) + 1

            logger.info(f"Cities represented: {len(cities)}")

            # Top 5 cities
            top_cities = sorted(cities.items(), key=lambda x: x[1], reverse=True)[:5]
            logger.info("\nTop 5 cities by concert count:")
            for city, count in top_cities:
                logger.info(f"  {city}: {count} concerts")

            # Show some performer examples
            logger.info(f"\nExample performers (first 10):")
            for performer in sorted(list(all_performers))[:10]:
                logger.info(f"  - {performer}")

            logger.info("\n✅ Test PASSED - Successfully parsed concerts with FlareSolverr!")
            return 0
        else:
            logger.error("❌ Test FAILED - No concerts extracted")
            return 1

    except Exception as e:
        logger.error(f"❌ Test FAILED with exception: {e}", exc_info=True)
        return 1
    finally:
        if 'parser_obj' in locals():
            parser_obj.http_client.close()
            logger.info("\nCleaned up HTTP client and destroyed FlareSolverr session")


def main():
    """Run the integration test"""
    setup_logging(verbose=True)
    return test_parse_germany_concerts()


if __name__ == '__main__':
    sys.exit(main())
