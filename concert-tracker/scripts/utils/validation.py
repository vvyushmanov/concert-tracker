"""
Validation utilities for artist sources and configuration

Provides centralized validation logic with clear error messages and suggestions.
"""

import re
from typing import Tuple, Optional
from enum import Enum
import logging


class ValidationStatus(Enum):
    """Validation result status"""
    VALID = "valid"
    WARNING = "warning"
    ERROR = "error"


class ValidationResult:
    """Result of a validation check"""

    def __init__(
        self,
        status: ValidationStatus,
        message: str = "",
        suggestions: Optional[list] = None
    ):
        self.status = status
        self.message = message
        self.suggestions = suggestions or []

    def is_valid(self) -> bool:
        """Check if validation passed (valid or warning)"""
        return self.status in (ValidationStatus.VALID, ValidationStatus.WARNING)

    def is_error(self) -> bool:
        """Check if validation failed"""
        return self.status == ValidationStatus.ERROR

    def __str__(self) -> str:
        """Format validation result as string"""
        output = []

        if self.message:
            output.append(f"{self.message}")

        if self.suggestions:
            output.append("\nSuggestions:")
            for i, suggestion in enumerate(self.suggestions, 1):
                output.append(f"  {i}. {suggestion}")

        return "\n".join(output)

    def log(self, logger: logging.Logger) -> None:
        """Log validation result at appropriate level based on status.

        Args:
            logger: Logger instance to use for output

        Example:
            >>> validation_result.log(logger)
        """
        message = str(self)
        if self.status == ValidationStatus.ERROR:
            logger.error(message)
        elif self.status == ValidationStatus.WARNING:
            logger.warning(message)
        else:
            logger.info(message)


def validate_artist_sources(
    user_id: int,
    lastfm_configured: bool,
    userartist_count: int,
    no_filter: bool
) -> ValidationResult:
    """
    Validate that we have artist sources for filtering concerts

    Args:
        user_id: User ID being processed
        lastfm_configured: Whether Last.fm API key and user are configured
        userartist_count: Number of UserArtist records for this user
        no_filter: Whether --no-filter mode is enabled

    Returns:
        ValidationResult with status, message, and suggestions

    Validation Logic:
        - If --no-filter: Always valid (no sources needed)
        - If filtering: At least one source (Last.fm OR UserArtist) required
        - Warning: Only one source available (degraded functionality)
        - Valid: Both sources available (optimal)
    """

    # Case 1: No-filter mode - always valid
    if no_filter:
        return ValidationResult(
            status=ValidationStatus.VALID,
            message="No-filter mode enabled - artist sources not required"
        )

    has_lastfm = lastfm_configured
    has_userartist = userartist_count > 0

    # Case 2: No sources available - ERROR
    if not has_lastfm and not has_userartist:
        return ValidationResult(
            status=ValidationStatus.ERROR,
            message="Cannot filter concerts - no artist sources available",
            suggestions=[
                "Configure Last.fm credentials (LASTFM_API_KEY and LASTFM_USER) in settings",
                f"Add artists to UserArtist table for user ID {user_id}",
                "Use --no-filter to fetch all concerts without filtering"
            ]
        )

    # Case 3: Only Last.fm available - WARNING
    if has_lastfm and not has_userartist:
        return ValidationResult(
            status=ValidationStatus.WARNING,
            message=f"Using Last.fm only (no UserArtist records found for user {user_id})",
            suggestions=[
                "Add artists to UserArtist table for better filtering",
                "UserArtist provides persistent artist list independent of Last.fm"
            ]
        )

    # Case 4: Only UserArtist available - WARNING
    if has_userartist and not has_lastfm:
        return ValidationResult(
            status=ValidationStatus.WARNING,
            message=f"Using UserArtist only ({userartist_count} artists, Last.fm not configured)",
            suggestions=[
                "Configure Last.fm for automatic playcount updates",
                "Last.fm provides 12-month activity tracking and discovery"
            ]
        )

    # Case 5: Both sources available - VALID (optimal)
    return ValidationResult(
        status=ValidationStatus.VALID,
        message=f"Using UserArtist ({userartist_count} artists) + Last.fm (optimal configuration)"
    )


def validate_database_connection(db_path: str, db_type: str = "sqlite") -> ValidationResult:
    """
    Validate database connection and accessibility

    Args:
        db_path: Path to database file (SQLite) or connection URL (MySQL)
        db_type: Database type ('sqlite' or 'mysql')

    Returns:
        ValidationResult indicating if database is accessible
    """
    import os

    if db_type.lower() == "sqlite":
        # Check if file exists and is accessible
        if not os.path.exists(db_path):
            return ValidationResult(
                status=ValidationStatus.ERROR,
                message=f"SQLite database not found: {db_path}",
                suggestions=[
                    "Check DB_PATH in configuration",
                    "Run database migrations to create schema",
                    "Ensure file path is correct and accessible"
                ]
            )

        if not os.access(db_path, os.R_OK | os.W_OK):
            return ValidationResult(
                status=ValidationStatus.ERROR,
                message=f"Cannot read/write SQLite database: {db_path}",
                suggestions=[
                    "Check file permissions",
                    "Ensure user has read/write access to database file"
                ]
            )

        return ValidationResult(
            status=ValidationStatus.VALID,
            message=f"SQLite database accessible: {db_path}"
        )

    # For MySQL, just check connection string format
    if db_type.lower() == "mysql":
        if not db_path.startswith("mysql://") and not db_path.startswith("mysql+pymysql://"):
            return ValidationResult(
                status=ValidationStatus.ERROR,
                message="Invalid MySQL connection URL format",
                suggestions=[
                    "URL should start with 'mysql://' or 'mysql+pymysql://'",
                    "Format: mysql://user:password@host:port/database"
                ]
            )

        return ValidationResult(
            status=ValidationStatus.VALID,
            message="MySQL connection URL format valid"
        )

    return ValidationResult(
        status=ValidationStatus.ERROR,
        message=f"Unknown database type: {db_type}",
        suggestions=["Use 'sqlite' or 'mysql' for db_type"]
    )


def validate_country_codes(country_codes: list) -> ValidationResult:
    """
    Validate country codes format

    Args:
        country_codes: List of country codes to validate

    Returns:
        ValidationResult indicating if country codes are valid
    """
    if not country_codes:
        return ValidationResult(
            status=ValidationStatus.ERROR,
            message="No country codes provided",
            suggestions=[
                "Add at least one country code to COUNTRY_CODES setting",
                "Use ISO 3166-1 alpha-2 format (e.g., 'tr', 'de', 'us')"
            ]
        )

    # Validate format (2-letter codes)
    invalid_codes = [code for code in country_codes if not isinstance(code, str) or len(code) != 2]

    if invalid_codes:
        return ValidationResult(
            status=ValidationStatus.ERROR,
            message=f"Invalid country codes: {', '.join(map(str, invalid_codes))}",
            suggestions=[
                "Country codes must be 2-letter ISO 3166-1 alpha-2 format",
                "Examples: 'tr' (Turkey), 'de' (Germany), 'us' (United States)"
            ]
        )

    return ValidationResult(
        status=ValidationStatus.VALID,
        message=f"Country codes valid ({len(country_codes)} countries)"
    )


def is_musicbrainz_id(value: str) -> bool:
    """
    Check if a string is a valid MusicBrainz ID (MBID).

    MBIDs are UUIDs in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    where x is a hexadecimal digit (0-9, a-f).

    Args:
        value: String to check

    Returns:
        True if value matches MBID/UUID format, False otherwise

    Examples:
        >>> is_musicbrainz_id("5b11f4ce-a62d-471e-81fc-a69a8278c7da")
        True
        >>> is_musicbrainz_id("Metallica")
        False
        >>> is_musicbrainz_id("5b11f4ce")  # Too short
        False
    """
    # UUID v4 format: 8-4-4-4-12 hexadecimal digits
    uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    return bool(re.match(uuid_pattern, value.lower()))
