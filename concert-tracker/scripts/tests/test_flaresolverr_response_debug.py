#!/usr/bin/env python3
"""
Debug FlareSolverr response to see all available fields for detection
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pathlib import Path
import requests
import json
import time

# Load environment variables
project_root = Path(__file__).parent.parent.parent.parent
dotenv_path = project_root / '.env'
load_dotenv(dotenv_path=dotenv_path)

from utils import get_logger, setup_logging
from services.http_client import get_flaresolverr_config

logger = get_logger(__name__)


def debug_flaresolverr_response():
    """Make a raw FlareSolverr request and inspect the full response"""
    logger.info("=" * 60)
    logger.info("FlareSolverr Response Debug")
    logger.info("=" * 60)

    flaresolverr_url, enabled = get_flaresolverr_config()
    if not enabled:
        logger.error("FLARESOLVERR_URL not set")
        return 1

    logger.info(f"FlareSolverr URL: {flaresolverr_url}")

    # Create session
    import uuid
    session_id = f"debug_{uuid.uuid4().hex[:8]}"

    logger.info(f"Creating session: {session_id}")
    requests.post(
        flaresolverr_url,
        json={"cmd": "sessions.create", "session": session_id},
        timeout=30
    )

    try:
        # Make request WITH tabs_till_verify (slow - challenge solving)
        logger.info("\n--- Request 1: WITH tabs_till_verify=1 (challenge detection) ---")
        start_time = time.time()

        response1 = requests.post(
            flaresolverr_url,
            json={
                "cmd": "request.get",
                "url": "https://en.concerts-metal.com/next_tr_p1.html",
                "session": session_id,
                "maxTimeout": 60000,
                "tabs_till_verify": 1
            },
            timeout=120
        )

        elapsed1 = time.time() - start_time
        data1 = response1.json()

        logger.info(f"Request took: {elapsed1:.2f} seconds (wall clock)")
        logger.info(f"\nTop-level keys: {list(data1.keys())}")

        if 'solution' in data1:
            solution = data1['solution']
            logger.info(f"\nSolution keys: {list(solution.keys())}")

            # Check for timing fields
            for key in ['startTimestamp', 'endTimestamp', 'duration', 'time']:
                if key in solution:
                    logger.info(f"  {key}: {solution[key]}")

            # Check cookies
            cookies = solution.get('cookies', [])
            logger.info(f"\nCookies ({len(cookies)} total):")
            for cookie in cookies:
                logger.info(f"  - {cookie.get('name')}: {cookie.get('value', '')[:50]}")

        # Make request WITHOUT tabs_till_verify (fast - direct load)
        logger.info("\n--- Request 2: WITHOUT tabs_till_verify (fast mode) ---")
        start_time = time.time()

        response2 = requests.post(
            flaresolverr_url,
            json={
                "cmd": "request.get",
                "url": "https://en.concerts-metal.com/next_tr_p2.html",
                "session": session_id,
                "maxTimeout": 60000
                # NO tabs_till_verify
            },
            timeout=120
        )

        elapsed2 = time.time() - start_time
        data2 = response2.json()

        logger.info(f"Request took: {elapsed2:.2f} seconds (wall clock)")
        logger.info(f"\nTop-level keys: {list(data2.keys())}")

        if 'solution' in data2:
            solution = data2['solution']
            logger.info(f"\nSolution keys: {list(solution.keys())}")

            # Check for timing fields
            for key in ['startTimestamp', 'endTimestamp', 'duration', 'time']:
                if key in solution:
                    logger.info(f"  {key}: {solution[key]}")

        # Comparison
        logger.info("\n" + "=" * 60)
        logger.info("COMPARISON")
        logger.info("=" * 60)
        logger.info(f"Request 1 (with tabs_till_verify): {elapsed1:.2f}s")
        logger.info(f"Request 2 (without tabs_till_verify): {elapsed2:.2f}s")
        logger.info(f"Speed difference: {elapsed1 - elapsed2:.2f}s")

    finally:
        # Cleanup
        requests.post(
            flaresolverr_url,
            json={"cmd": "sessions.destroy", "session": session_id},
            timeout=10
        )
        logger.info("\nSession destroyed")

    return 0


def main():
    setup_logging(verbose=True)
    return debug_flaresolverr_response()


if __name__ == '__main__':
    sys.exit(main())
