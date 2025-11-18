#!/usr/bin/env python3
"""
Centralized configuration manager with DB-first, ENV fallback strategy

Priority:
1. Database (Setting table)
2. Environment variables (.env)
3. Hardcoded defaults

Features:
- In-memory caching (60s TTL by default)
- Thread-safe singleton
- Type conversion (string, int, bool, json)
- Auto-migration from ENV to DB on first run
"""

import os
import json
import threading
import time
from typing import Any, Dict, Optional, Tuple
from datetime import datetime, UTC
from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from database.config import get_engine
from database.models import Setting, Base, Country
from utils import get_logger, setup_logging

logger = get_logger(__name__)

# Load environment variables
load_dotenv()


class ConfigManager:
    """
    Singleton configuration manager with DB-first, ENV fallback strategy
    """
    
    _instance = None
    _lock = threading.Lock()
    
    # Configuration keys with defaults (value, type, description)
    DEFAULTS = {
        'LASTFM_API_KEY': ('', 'string', 'Last.fm API key for fetching artist data'),
        'LASTFM_USER': ('', 'string', 'Last.fm username to fetch top artists from'),
        'COUNTRY_CODES': ('["tr","fr","de"]', 'json', 'Country codes to scan for concerts'),
        'MIN_PLAYCOUNT': ('40', 'int', 'Minimum playcount threshold for filtering artists'),
        'FANART_API_KEY': ('', 'string', 'Fanart.tv API key for fetching artist images'),
        'WEBSHARE_PROXY_URL': ('', 'string', 'Webshare.io proxy download URL'),
    }
    
    def __new__(cls):
        """Singleton pattern with thread safety"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(ConfigManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        """Initialize cache and DB connection"""
        if self._initialized:
            return
        
        self._cache = {}  # {key: (value, value_type, timestamp)}
        self._cache_ttl = 60  # Cache TTL in seconds
        self._cache_lock = threading.Lock()
        self._engine = None
        self._Session = None
        self._initialized = True
        
        # Initialize database connection
        try:
            self._engine = get_engine(echo=False)
            self._Session = sessionmaker(bind=self._engine)
            self._ensure_settings_table()
            self._migrate_from_env()
        except Exception as e:
            logger.warning(f"ConfigManager DB initialization failed: {e}")
            logger.warning("Falling back to environment variables only")
    
    def _ensure_settings_table(self):
        """Create Setting table if it doesn't exist"""
        try:
            Base.metadata.create_all(self._engine, tables=[Setting.__table__])
        except Exception as e:
            logger.warning(f"Could not create Setting table: {e}")
    
    def _migrate_from_env(self):
        """Auto-migrate ENV vars to DB on first run"""
        if not self._Session:
            return

        session = None
        try:
            session = self._Session()
            # Check if Setting table is empty
            count = session.query(Setting).count()
            if count > 0:
                # Already migrated
                return
            
            logger.info("🔄 First run detected - migrating settings from .env to database...")
            
            # Migrate all default settings
            migrated = 0
            for key, (default_value, value_type, description) in self.DEFAULTS.items():
                # Get value from ENV or use default
                env_value = os.getenv(key)
                
                if env_value is not None:
                    # Special handling for COUNTRY_CODES
                    if key == 'COUNTRY_CODES':
                        # Convert comma-separated to JSON array
                        codes = [code.strip() for code in env_value.split(',')]
                        value = json.dumps(codes)
                    else:
                        value = env_value
                else:
                    value = default_value
                
                # Create setting
                setting = Setting(
                    key=key,
                    value=value,
                    valueType=value_type,
                    description=description,
                    createdAt=int(datetime.now(UTC).timestamp()),
                    updatedAt=int(datetime.now(UTC).timestamp())
                )
                session.add(setting)
                migrated += 1
            
            session.commit()
            logger.info(f"✅ Migrated {migrated} settings from .env to database")
            
        except Exception as e:
            if session:
                session.rollback()
            logger.warning(f"Settings migration failed: {e}")
        finally:
            if session:
                session.close()
    
    def get(self, key: str, default: Optional[str] = None) -> str:
        """Get setting as string"""
        value, _ = self._get_value(key)
        if value is None:
            return default
        return str(value)
    
    def get_int(self, key: str, default: int = 0) -> int:
        """Get setting as integer"""
        value, value_type = self._get_value(key)
        if value is None:
            return default
        try:
            return int(value)
        except (ValueError, TypeError):
            return default
    
    def get_bool(self, key: str, default: bool = False) -> bool:
        """Get setting as boolean"""
        value, value_type = self._get_value(key)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes', 'on')
        return bool(value)
    
    def get_json(self, key: str, default: Any = None) -> Any:
        """Get setting as parsed JSON"""
        value, value_type = self._get_value(key)
        if value is None:
            return default
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return default
    
    def get_list(self, key: str, default: Optional[list] = None) -> list:
        """Get setting as list (convenience for JSON arrays)"""
        result = self.get_json(key, default)
        if isinstance(result, list):
            return result
        return default if default is not None else []
    
    def set(self, key: str, value: Any, value_type: Optional[str] = None):
        """Set setting in DB and invalidate cache"""
        if not self._Session:
            raise RuntimeError("ConfigManager not properly initialized with database")
        
        session = self._Session()
        try:
            # Auto-detect type if not provided
            if value_type is None:
                if isinstance(value, bool):
                    value_type = 'bool'
                elif isinstance(value, int):
                    value_type = 'int'
                elif isinstance(value, (list, dict)):
                    value_type = 'json'
                else:
                    value_type = 'string'
            
            # Convert value to string for storage
            if value_type == 'json':
                str_value = json.dumps(value)
            elif value_type == 'bool':
                str_value = 'true' if value else 'false'
            else:
                str_value = str(value)
            
            # Upsert setting
            setting = session.query(Setting).filter(Setting.key == key).first()
            if setting:
                setting.value = str_value
                setting.valueType = value_type
                setting.updatedAt = int(datetime.now(UTC).timestamp())
            else:
                description = self.DEFAULTS.get(key, (None, None, None))[2]
                setting = Setting(
                    key=key,
                    value=str_value,
                    valueType=value_type,
                    description=description,
                    createdAt=int(datetime.now(UTC).timestamp()),
                    updatedAt=int(datetime.now(UTC).timestamp())
                )
                session.add(setting)
            
            session.commit()
            
            # Invalidate cache
            self.invalidate_cache(key)
            
        except Exception as e:
            session.rollback()
            raise RuntimeError(f"Failed to set setting '{key}': {e}")
        finally:
            session.close()
    
    def invalidate_cache(self, key: Optional[str] = None):
        """Invalidate cache (all keys or specific key)"""
        with self._cache_lock:
            if key is None:
                self._cache.clear()
            elif key in self._cache:
                del self._cache[key]
    
    def get_all(self) -> Dict[str, Any]:
        """Get all settings as dict"""
        if not self._Session:
            # Fallback to ENV only
            result = {}
            for key in self.DEFAULTS.keys():
                result[key] = self.get(key)
            return result
        
        session = self._Session()
        try:
            settings = session.query(Setting).all()
            result = {}
            for setting in settings:
                # Convert based on type
                if setting.valueType == 'int':
                    result[setting.key] = int(setting.value)
                elif setting.valueType == 'bool':
                    result[setting.key] = setting.value.lower() in ('true', '1', 'yes')
                elif setting.valueType == 'json':
                    result[setting.key] = json.loads(setting.value)
                else:
                    result[setting.key] = setting.value
            return result
        finally:
            session.close()
    
    def _get_value(self, key: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Internal: Get value with three-tier fallback
        Returns: (value, value_type) or (None, None)
        """
        # Check cache first
        with self._cache_lock:
            if key in self._cache:
                value, value_type, timestamp = self._cache[key]
                # Check if cache is still valid
                if time.time() - timestamp < self._cache_ttl:
                    return value, value_type
                else:
                    # Cache expired
                    del self._cache[key]
        
        # Try DB
        value, value_type = self._get_from_db(key)
        if value is not None:
            # Cache it
            with self._cache_lock:
                self._cache[key] = (value, value_type, time.time())
            return value, value_type
        
        # Try ENV
        env_value = self._get_from_env(key)
        if env_value is not None:
            # Determine type from defaults
            default_value, default_type, _ = self.DEFAULTS.get(key, (None, 'string', None))
            return env_value, default_type
        
        # Try defaults
        default_value, default_type, _ = self._get_default(key)
        return default_value, default_type
    
    def _get_from_db(self, key: str) -> Tuple[Optional[str], Optional[str]]:
        """Internal: Get from DB, returns (value, value_type)"""
        if not self._Session:
            return None, None
        
        session = self._Session()
        try:
            setting = session.query(Setting).filter(Setting.key == key).first()
            if setting:
                return setting.value, setting.valueType
            return None, None
        except Exception as e:
            logger.error(f"DB query failed for key '{key}': {e}")
            return None, None
        finally:
            session.close()
    
    def _get_from_env(self, key: str) -> Optional[str]:
        """Internal: Get from ENV"""
        value = os.getenv(key)
        if value is not None and key == 'COUNTRY_CODES':
            # Convert comma-separated to JSON array for consistency
            codes = [code.strip() for code in value.split(',')]
            return json.dumps(codes)
        return value
    
    def _get_default(self, key: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Internal: Get default value, type, and description"""
        return self.DEFAULTS.get(key, (None, None, None))
    
    def get_active_country_codes(self) -> list[str]:
        """
        Get list of active country codes from database with env var fallback
        
        Returns:
            List of country codes (e.g., ['tr', 'fr', 'de'])
        """
        if not self._Session:
            # Fallback to COUNTRY_CODES env var/setting
            return self.get_list('COUNTRY_CODES', ['tr', 'fr', 'de'])
        
        session = self._Session()
        try:
            # Query active countries from database
            active_countries = session.query(Country).filter(Country.active == True).all()
            
            if active_countries:
                # Return codes from active countries
                return [country.code for country in active_countries]
            else:
                # No active countries found, fallback to COUNTRY_CODES setting
                return self.get_list('COUNTRY_CODES', ['tr', 'fr', 'de'])
                
        except Exception as e:
            logger.error(f"Failed to query active countries: {e}")
            # Fallback to COUNTRY_CODES setting
            return self.get_list('COUNTRY_CODES', ['tr', 'fr', 'de'])
        finally:
            session.close()


# Convenience function for quick access
def get_config() -> ConfigManager:
    """Get ConfigManager singleton instance"""
    return ConfigManager()


if __name__ == '__main__':
    # Test the config manager
    config = ConfigManager()
    
    logger.info("=== ConfigManager Test ===")
    
    logger.info("All settings:")
    all_settings = config.get_all()
    for key, value in all_settings.items():
        logger.info(f"  {key}: {value}")
    
    logger.info("--- Type-safe getters ---")
    logger.info(f"LASTFM_API_KEY (string): {config.get('LASTFM_API_KEY')}")
    logger.info(f"MIN_PLAYCOUNT (int): {config.get_int('MIN_PLAYCOUNT')}")
    logger.info(f"COUNTRY_CODES (list): {config.get_list('COUNTRY_CODES')}")
    
    logger.info("✅ ConfigManager test complete")
