"""
Credential loading utilities for user-specific and global configuration

Provides centralized credential loading with validation.

Configuration Hierarchy:
========================

Per-User Settings (UserSetting table):
- LASTFM_USER: ALWAYS user-specific, NEVER global
- MIN_PLAYCOUNT: ONLY user-specific
- LASTFM_API_KEY: Can be user-specific (overrides global if set)

Global Settings (Setting table):
- FANART_API_KEY: ALWAYS global (shared resource)
- LASTFM_API_KEY: Can be global (fallback if user doesn't have their own)

Usage:
======

User-specific mode (for per-user filtering):
    credentials, validation = load_credentials(user_id=1)
    # credentials.lastfm_user comes from UserSetting
    # credentials.min_playcount comes from UserSetting
    # credentials.lastfm_api_key from UserSetting or global fallback
    # credentials.fanart_api_key always from global Setting

Global mode (for all concerts/artists):
    credentials, validation = load_credentials()  # No user_id
    # All credentials come from global Setting table
    # Use for: refreshing all artists, getting all concerts, admin tasks
"""

from typing import Dict, Optional, Tuple
from dataclasses import dataclass

from config import ConfigManager, load_user_config
from utils.validation import ValidationResult, ValidationStatus


@dataclass
class UserCredentials:
    """Container for user-specific credentials and configuration"""
    user_id: Optional[int]
    username: Optional[str]
    lastfm_api_key: Optional[str]
    lastfm_user: Optional[str]
    fanart_api_key: Optional[str]
    min_playcount: int
    country_codes: list
    settings: Dict[str, str]

    def has_lastfm(self) -> bool:
        """Check if Last.fm credentials are configured"""
        return bool(self.lastfm_api_key and self.lastfm_user)

    def has_fanart(self) -> bool:
        """Check if Fanart.tv API key is configured"""
        return bool(self.fanart_api_key)


def load_credentials(
    user_id: Optional[int] = None,
    db_path: Optional[str] = None,
    require_lastfm: bool = False,
    require_countries: bool = False
) -> Tuple[UserCredentials, ValidationResult]:
    """
    Load credentials with validation - supports both user-specific and global modes

    This function centralizes credential loading logic used across scripts.
    - With user_id: Loads per-user credentials from UserSetting table
      Use for: Per-user concert filtering, user-specific artist lists
    - Without user_id: Loads global credentials from Setting table
      Use for: Refreshing all artists, getting all concerts, admin tasks

    Args:
        user_id: User ID (optional - if None, uses global mode)
        db_path: Database path (for SQLite)
        require_lastfm: If True, return error if Last.fm not configured
        require_countries: If True, return error if no active countries

    Returns:
        Tuple of (UserCredentials, ValidationResult)
        - UserCredentials: Loaded credentials (may be incomplete)
        - ValidationResult: Validation status (ERROR or VALID)

    Example (user-specific mode):
        credentials, validation = load_credentials(user_id=1, db_path="data/db.sqlite")
        if validation.is_error():
            print(validation)
            return 1

    Example (global mode):
        credentials, validation = load_credentials(db_path="data/db.sqlite")
        # Returns global configuration for admin/maintenance tasks
    """

    # Global mode - no user_id provided
    if user_id is None:
        config = ConfigManager()

        # Get country codes from active countries (Country.active = true)
        # Falls back to COUNTRY_CODES setting if no active countries found
        try:
            country_codes = config.get_active_country_codes()
        except Exception:
            country_codes = []

        credentials = UserCredentials(
            user_id=None,
            username=None,
            lastfm_api_key=config.get('LASTFM_API_KEY'),
            lastfm_user=None,
            fanart_api_key=config.get('FANART_API_KEY'),
            min_playcount=config.get_int('MIN_PLAYCOUNT', 40),
            country_codes=country_codes,
            settings={}
        )

        # Validation
        validation_messages = []
        has_errors = False

        # Check Last.fm if required
        if require_lastfm and not credentials.has_lastfm():
            validation_messages.append("Last.fm credentials required but not configured")
            has_errors = True

        # Check countries if required
        if require_countries and not credentials.country_codes:
            validation_messages.append("No active countries configured")
            has_errors = True

        if has_errors:
            return credentials, ValidationResult(
                status=ValidationStatus.ERROR,
                message="\n".join(validation_messages),
                suggestions=[
                    "Configure global settings in the Setting table",
                    "Or use --user-id for per-user configuration"
                ]
            )

        # Success - global mode
        return credentials, ValidationResult(
            status=ValidationStatus.VALID,
            message="Using global configuration (all concerts/artists mode)"
        )

    # User-specific mode - load user configuration
    try:
        user_config_data = load_user_config(user_id, db_path)
        user = user_config_data['user']
        user_settings = user_config_data['settings']
        country_codes = user_config_data['active_countries']

        # Extract user-specific credentials
        # LASTFM_USER: ALWAYS user-specific (NEVER global)
        lastfm_user = user_settings.get('LASTFM_USER')

        # MIN_PLAYCOUNT: ONLY user-specific
        min_playcount = int(user_settings.get('MIN_PLAYCOUNT', '1'))

        # Get global config for fallback
        config = ConfigManager()

        # LASTFM_API_KEY: User-specific if set, otherwise fall back to global
        lastfm_api_key = user_settings.get('LASTFM_API_KEY')
        if not lastfm_api_key:
            lastfm_api_key = config.get('LASTFM_API_KEY')

        # FANART_API_KEY: ALWAYS global (shared resource)
        fanart_api_key = config.get('FANART_API_KEY')

        credentials = UserCredentials(
            user_id=user_id,
            username=user.username,
            lastfm_api_key=lastfm_api_key,
            lastfm_user=lastfm_user,
            fanart_api_key=fanart_api_key,
            min_playcount=min_playcount,
            country_codes=country_codes,
            settings=user_settings
        )

        # Validation
        validation_messages = []
        has_errors = False

        # Check Last.fm if required
        if require_lastfm and not credentials.has_lastfm():
            validation_messages.append("Last.fm credentials required but not configured")
            has_errors = True

        # Check countries if required
        if require_countries and not country_codes:
            validation_messages.append("No active countries configured for this user")
            has_errors = True

        if has_errors:
            return credentials, ValidationResult(
                status=ValidationStatus.ERROR,
                message="\n".join(validation_messages),
                suggestions=[
                    "Configure user settings in the Settings page",
                    "Ensure Last.fm API key and username are set" if require_lastfm else None,
                    "Activate at least one country" if require_countries else None
                ]
            )

        # Success - return credentials with valid status
        return credentials, ValidationResult(
            status=ValidationStatus.VALID,
            message=f"User credentials loaded: {user.username} (ID: {user_id})"
        )

    except ValueError as e:
        # User not found or database error
        return None, ValidationResult(
            status=ValidationStatus.ERROR,
            message=str(e),
            suggestions=[
                f"Ensure user ID {user_id} exists in database",
                "Check database path and connection"
            ]
        )
