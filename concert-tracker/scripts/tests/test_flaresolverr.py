#!/usr/bin/env python3
"""
Test FlareSolverr integration with HTTPClient and concerts-metal.com parsing
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
from bs4 import BeautifulSoup

logger = get_logger(__name__)


def test_flaresolverr_availability():
    """Test if FlareSolverr is available and responding"""
    logger.info("=== Testing FlareSolverr Availability ===")

    flaresolverr_url, flaresolverr_enabled = get_flaresolverr_config()

    if not flaresolverr_enabled:
        logger.error("❌ FLARESOLVERR_URL not set in environment")
        logger.info("Please set FLARESOLVERR_URL in your .env file (default: http://localhost:8191/v1)")
        return False

    logger.info(f"FlareSolverr URL: {flaresolverr_url}")

    # Try to connect to FlareSolverr
    import requests
    try:
        response = requests.post(
            flaresolverr_url,
            json={"cmd": "sessions.list"},
            timeout=10
        )
        if response.status_code == 200:
            logger.info("✅ FlareSolverr is available and responding")
            return True
        else:
            logger.error(f"❌ FlareSolverr returned unexpected status: {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ Failed to connect to FlareSolverr: {e}")
        logger.info("Make sure FlareSolverr is running (docker run -p 8191:8191 flaresolverr/flaresolverr)")
        return False


def test_http_client_with_flaresolverr():
    """Test HTTPClient with FlareSolverr enabled"""
    logger.info("\n=== Testing HTTPClient with FlareSolverr ===")

    # Use the actual URL pattern from concerts-metal.com
    test_url = "https://en.concerts-metal.com/next_tr_p1.html"

    with HTTPClient(use_flaresolverr=True, timeout=30) as client:
        logger.info(f"Fetching: {test_url}")
        response = client.get(test_url)

        if response:
            logger.info(f"✅ Request successful (status: {response.status_code})")
            logger.info(f"Response size: {len(response.content)} bytes")

            # Check if we got HTML content
            soup = BeautifulSoup(response.content, 'html.parser')
            title = soup.find('title')
            if title:
                logger.info(f"Page title: {title.get_text().strip()}")

            # Check for concert listings
            concert_divs = soup.find_all('div', class_='concert-item')
            logger.info(f"Found {len(concert_divs)} concert items")

            # Check for Cloudflare challenge
            if 'cloudflare' in response.text.lower() or 'turnstile' in response.text.lower():
                logger.warning("⚠️ Cloudflare challenge detected in response")
                return False

            if len(concert_divs) > 0:
                logger.info("✅ Successfully bypassed Cloudflare and got concert data")
                return True
            else:
                logger.info("⚠️ No concert data found - checking HTML structure...")
                # Print first 500 chars of body
                body = soup.find('body')
                if body:
                    logger.debug(f"Body preview: {str(body)[:500]}...")
                return True  # Still successful if we got HTML
        else:
            logger.error("❌ Request failed")
            return False


def test_http_client_without_flaresolverr():
    """Test HTTPClient without FlareSolverr (baseline)"""
    logger.info("\n=== Testing HTTPClient WITHOUT FlareSolverr ===")

    # Use the actual URL pattern from concerts-metal.com
    test_url = "https://en.concerts-metal.com/next_tr_p1.html"

    with HTTPClient(use_flaresolverr=False, timeout=15) as client:
        logger.info(f"Fetching: {test_url}")
        response = client.get(test_url)

        if response:
            logger.info(f"Request successful (status: {response.status_code})")

            # Check for Cloudflare challenge
            if 'cloudflare' in response.text.lower() or 'turnstile' in response.text.lower():
                logger.info("⚠️ Cloudflare challenge detected (expected without FlareSolverr)")
                return False

            soup = BeautifulSoup(response.content, 'html.parser')
            concert_divs = soup.find_all('div', class_='concert-item')
            logger.info(f"Found {len(concert_divs)} concert items")

            if len(concert_divs) > 0:
                logger.info("✅ No Cloudflare protection currently active")
                return True
            else:
                logger.info("⚠️ No concert data found")
                return True
        else:
            logger.error("❌ Request failed completely")
            return False


def test_parser_integration():
    """Test full parser integration with FlareSolverr"""
    logger.info("\n=== Testing Parser Integration with FlareSolverr ===")

    try:
        # Temporarily modify CountryConcertParser to use FlareSolverr
        # We need to patch it after creation since constructor doesn't accept http_client
        parser_obj = CountryConcertParser(
            country_code="tr",
            delay=1.0
        )

        # Replace the http_client with FlareSolverr-enabled one
        parser_obj.http_client.close()  # Close old client
        parser_obj.http_client = HTTPClient(use_flaresolverr=True, timeout=30, use_system_ca=True)

        logger.info("Attempting to detect max pages...")
        max_pages = parser_obj._detect_max_pages()

        if max_pages > 0:
            logger.info(f"✅ Successfully detected {max_pages} pages")

            # Try to parse first page
            logger.info("Attempting to parse first page...")
            concerts = parser_obj.parse_page(1)

            if concerts:
                logger.info(f"✅ Successfully parsed {len(concerts)} concerts from first page")

                # Show first concert as example
                if concerts:
                    first = concerts[0]
                    logger.info(f"Example concert: {first.get('event_name', 'N/A')}")
                    logger.info(f"  Date: {first.get('date_start', 'N/A')}")
                    logger.info(f"  Venue: {first.get('venue', 'N/A')}")
                    logger.info(f"  Performers: {', '.join(first.get('performers', []))}")

                return True
            else:
                logger.warning("⚠️ No concerts found on first page")
                return False
        else:
            logger.error("❌ Failed to detect pages (max_pages = 0)")
            return False

    except Exception as e:
        logger.error(f"❌ Parser test failed: {e}", exc_info=True)
        return False
    finally:
        if 'parser_obj' in locals():
            parser_obj.http_client.close()
            logger.info("Cleaned up HTTP client and destroyed FlareSolverr session")


def main():
    """Run all FlareSolverr integration tests"""
    setup_logging(verbose=True)

    logger.info("=" * 60)
    logger.info("FlareSolverr Integration Tests")
    logger.info("=" * 60)

    results = {}

    # Test 1: FlareSolverr availability
    results['availability'] = test_flaresolverr_availability()

    if not results['availability']:
        logger.error("\n❌ FlareSolverr not available - cannot proceed with tests")
        logger.info("Please start FlareSolverr and try again")
        return 1

    # Test 2: HTTP client without FlareSolverr (baseline)
    results['without_flaresolverr'] = test_http_client_without_flaresolverr()

    # Test 3: HTTP client with FlareSolverr
    results['with_flaresolverr'] = test_http_client_with_flaresolverr()

    # Test 4: Full parser integration
    results['parser_integration'] = test_parser_integration()

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("Test Summary")
    logger.info("=" * 60)

    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{status}: {test_name}")

    passed = sum(1 for r in results.values() if r)
    total = len(results)

    logger.info(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        logger.info("\n🎉 All tests passed!")
        return 0
    else:
        logger.info(f"\n⚠️ {total - passed} test(s) failed")
        return 1


if __name__ == '__main__':
    sys.exit(main())
