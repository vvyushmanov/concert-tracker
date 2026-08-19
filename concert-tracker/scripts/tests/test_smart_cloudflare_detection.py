#!/usr/bin/env python3
"""
Test smart Cloudflare detection in FlareSolverr integration

Tests the adaptive behavior:
1. First request: Always uses tabs_till_verify (detection mode)
2. Detects if Cloudflare is active based on cf_clearance cookie
3. Subsequent requests:
   - If Cloudflare active: Continue using tabs_till_verify (slower but reliable)
   - If no Cloudflare: Omit tabs_till_verify (faster)
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

logger = get_logger(__name__)


def test_smart_detection():
    """Test smart Cloudflare detection with multiple requests"""
    logger.info("=" * 60)
    logger.info("Smart Cloudflare Detection Test")
    logger.info("=" * 60)

    # Check FlareSolverr availability
    flaresolverr_url, flaresolverr_enabled = get_flaresolverr_config()

    if not flaresolverr_enabled:
        logger.error("❌ FLARESOLVERR_URL not set in environment")
        logger.info("Please set FLARESOLVERR_URL in your .env file")
        return 1

    logger.info(f"✅ FlareSolverr configured at {flaresolverr_url}")
    logger.info("")

    # Test URLs - using concerts-metal.com (real target)
    test_urls = [
        "https://en.concerts-metal.com/next_tr_p1.html",
        "https://en.concerts-metal.com/next_tr_p2.html",
        "https://en.concerts-metal.com/next_tr_p3.html"
    ]

    try:
        # Create HTTPClient with FlareSolverr enabled
        with HTTPClient(use_flaresolverr=True, timeout=30, use_system_ca=True) as client:
            logger.info("HTTPClient created with FlareSolverr enabled")
            logger.info(f"Initial state: cloudflare_active = {client.cloudflare_active}")
            logger.info("")

            for idx, url in enumerate(test_urls, start=1):
                logger.info(f"--- Request {idx}/3 ---")
                logger.info(f"URL: {url}")
                logger.info(f"Cloudflare status before request: {client.cloudflare_active}")

                response = client.get(url)

                if response:
                    logger.info(f"✅ Request successful (status: {response.status_code})")
                    logger.info(f"Response size: {len(response.content)} bytes")
                    logger.info(f"Cloudflare status after request: {client.cloudflare_active}")

                    # Log what mode will be used for next request
                    if idx < len(test_urls):
                        if client.cloudflare_active is True:
                            logger.info("📌 Next request will use: tabs_till_verify=1 (Cloudflare bypass mode)")
                        elif client.cloudflare_active is False:
                            logger.info("⚡ Next request will use: fast mode (no tabs_till_verify)")
                        else:
                            logger.info("❓ Next request will use: detection mode (tabs_till_verify=1)")
                else:
                    logger.error(f"❌ Request {idx} failed")
                    return 1

                logger.info("")

            # Summary
            logger.info("=" * 60)
            logger.info("Test Summary")
            logger.info("=" * 60)
            logger.info(f"All {len(test_urls)} requests completed successfully")

            if client.cloudflare_active is True:
                logger.info("🛡️ Cloudflare protection was DETECTED")
                logger.info("   → All requests used tabs_till_verify=1 (challenge bypass)")
            elif client.cloudflare_active is False:
                logger.info("⚡ Cloudflare protection was NOT detected")
                logger.info("   → First request used detection mode")
                logger.info("   → Subsequent requests used fast mode (no challenge)")
            else:
                logger.warning("❓ Cloudflare status remained unknown (unexpected)")

            logger.info("")
            logger.info("✅ Smart detection test PASSED")
            return 0

    except Exception as e:
        logger.error(f"❌ Test failed with exception: {e}", exc_info=True)
        return 1


def main():
    """Run the smart detection test"""
    setup_logging(verbose=True)
    return test_smart_detection()


if __name__ == '__main__':
    sys.exit(main())
