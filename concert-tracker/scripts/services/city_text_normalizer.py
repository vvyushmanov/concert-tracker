"""
City text normalization service.

Provides text normalization for city names including:
- Abbreviation expansion (St. -> Saint)
- Diacritic removal (Düsseldorf -> Dusseldorf)
- Whitespace normalization
- Parenthetical suffix removal (Lyon (Décines-Charpieu) -> Lyon)
"""

import re
from typing import Dict
from unidecode import unidecode


class CityTextNormalizer:
    """
    Normalizes city name text for consistent storage and matching.

    This class handles text-level normalization without any geocoding
    or database operations. It's a pure function that transforms
    city name strings.

    Example:
        >>> normalizer = CityTextNormalizer()
        >>> normalizer.normalize("St. Petersburg")
        'Saint Petersburg'
        >>> normalizer.normalize("Düsseldorf")
        'Dusseldorf'
        >>> normalizer.normalize("Lyon (Décines-Charpieu)")
        'Lyon'
    """

    # Text normalization rules - abbreviation expansions
    ABBREVIATIONS: Dict[str, str] = {
        'St.': 'Saint',
        'St ': 'Saint ',
        'Ste.': 'Sainte',
        'Ste ': 'Sainte ',
    }

    def normalize(self, city: str) -> str:
        """
        Apply text normalization rules to a city name.

        Normalization steps:
        1. Expand abbreviations (St. -> Saint)
        2. Remove diacritics using unidecode
        3. Normalize whitespace (multiple spaces -> single space)
        4. Remove parenthetical suffixes
        5. Apply title case

        Args:
            city: Original city name with potential diacritics and abbreviations

        Returns:
            Normalized city name in title case without diacritics
        """
        if not city:
            return city

        result = city

        # Apply abbreviation replacements
        for abbr, full in self.ABBREVIATIONS.items():
            result = result.replace(abbr, full)

        # Remove diacritics (Düsseldorf -> Dusseldorf)
        result = unidecode(result)

        # Normalize whitespace (multiple spaces -> single space)
        result = re.sub(r'\s+', ' ', result).strip()

        # Remove parenthetical suffixes (e.g., "Lyon (Décines-Charpieu)" -> "Lyon")
        # But only if there's content before the parenthesis
        match = re.match(r'^([^(]+?)\s*\([^)]+\)$', result)
        if match:
            result = match.group(1).strip()

        # Capitalize properly (Title Case)
        result = result.title()

        return result


# Convenience function for quick normalization without class instantiation
def normalize_city_text(city: str) -> str:
    """
    Normalize a city name string.

    This is a convenience function that creates a CityTextNormalizer
    instance and normalizes the city name.

    Args:
        city: Original city name

    Returns:
        Normalized city name

    Example:
        >>> normalize_city_text("münchen")
        'Munchen'
    """
    return CityTextNormalizer().normalize(city)
