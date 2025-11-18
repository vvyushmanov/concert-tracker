#!/usr/bin/env python3
"""
CLI tool to invalidate ConfigManager cache
Called by Next.js API after settings updates

Usage:
    python invalidate_cache.py              # Invalidate all cache
    python invalidate_cache.py SETTING_KEY  # Invalidate specific key
"""

import sys
from config import ConfigManager
from utils import get_logger, setup_logging

logger = get_logger(__name__)
setup_logging()

if __name__ == '__main__':
    config = ConfigManager()
    
    if len(sys.argv) > 1:
        key = sys.argv[1]
        config.invalidate_cache(key)
        logger.info(f"✅ Cache invalidated for: {key}")
    else:
        config.invalidate_cache()
        logger.info("✅ All cache invalidated")
