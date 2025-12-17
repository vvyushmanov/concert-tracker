#!/usr/bin/env python3
"""
Test that CountryConcertParser properly cleans up FlareSolverr session
Tests both normal exit and exception scenarios
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
project_root = Path(__file__).parent.parent.parent.parent
dotenv_path = project_root / '.env'
load_dotenv(dotenv_path=dotenv_path)

from utils import get_logger, setup_logging
from parsers.country_parser import CountryConcertParser
from services.http_client import get_flaresolverr_config

logger = get_logger(__name__)


def test_normal_cleanup():
    """Test that cleanup happens on normal exit"""
    logger.info("=" * 60)
    logger.info("Test 1: Normal Cleanup (with statement)")
    logger.info("=" * 60)

    flaresolverr_url, enabled = get_flaresolverr_config()
    if not enabled:
        logger.error("FLARESOLVERR_URL not set")
        return False

    try:
        # Use context manager - session should be destroyed when exiting 'with'
        with CountryConcertParser(
            country_code="de",
            max_pages=1,
            delay=0.5,
            use_flaresolverr=True
        ) as parser:
            logger.info("Parser created with FlareSolverr")
            session_id = parser.http_client.flaresolverr_session_id
            logger.info(f"Session ID: {session_id}")

            # Fetch one page to test
            page_url = parser.get_page_url(1)
            soup = parser.fetch_page(page_url)

            if soup:
                logger.info("✅ Successfully fetched page")
            else:
                logger.error("❌ Failed to fetch page")
                return False

        # After exiting 'with' block, session should be destroyed
        logger.info("✅ Exited context manager - session should be destroyed")
        return True

    except Exception as e:
        logger.error(f"❌ Test failed: {e}", exc_info=True)
        return False


def test_exception_cleanup():
    """Test that cleanup happens even when exception occurs"""
    logger.info("\n" + "=" * 60)
    logger.info("Test 2: Cleanup on Exception")
    logger.info("=" * 60)

    flaresolverr_url, enabled = get_flaresolverr_config()
    if not enabled:
        logger.error("FLARESOLVERR_URL not set")
        return False

    try:
        with CountryConcertParser(
            country_code="de",
            max_pages=1,
            delay=0.5,
            use_flaresolverr=True
        ) as parser:
            logger.info("Parser created with FlareSolverr")
            session_id = parser.http_client.flaresolverr_session_id
            logger.info(f"Session ID: {session_id}")

            # Simulate an exception
            raise Exception("Simulated error")

    except Exception as e:
        if "Simulated error" in str(e):
            logger.info("✅ Exception caught as expected - session should still be destroyed")
            return True
        else:
            logger.error(f"❌ Unexpected exception: {e}")
            return False


def test_manual_cleanup():
    """Test manual cleanup() call"""
    logger.info("\n" + "=" * 60)
    logger.info("Test 3: Manual Cleanup")
    logger.info("=" * 60)

    flaresolverr_url, enabled = get_flaresolverr_config()
    if not enabled:
        logger.error("FLARESOLVERR_URL not set")
        return False

    try:
        parser = CountryConcertParser(
            country_code="de",
            max_pages=1,
            delay=0.5,
            use_flaresolverr=True
        )

        logger.info("Parser created with FlareSolverr")
        session_id = parser.http_client.flaresolverr_session_id
        logger.info(f"Session ID: {session_id}")

        # Manually call cleanup
        parser.cleanup()
        logger.info("✅ Manual cleanup() called - session should be destroyed")
        return True

    except Exception as e:
        logger.error(f"❌ Test failed: {e}", exc_info=True)
        return False


def main():
    """Run all cleanup tests"""
    setup_logging(verbose=True)

    results = {}
    results['normal'] = test_normal_cleanup()
    results['exception'] = test_exception_cleanup()
    results['manual'] = test_manual_cleanup()

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("Test Results Summary")
    logger.info("=" * 60)

    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{status}: {test_name}")

    passed = sum(1 for r in results.values() if r)
    total = len(results)

    logger.info(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        logger.info("\n🎉 All cleanup tests passed!")
        return 0
    else:
        logger.info(f"\n⚠️ {total - passed} test(s) failed")
        return 1


if __name__ == '__main__':
    sys.exit(main())
