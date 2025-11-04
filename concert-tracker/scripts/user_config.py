"""
User configuration helper for loading per-user settings and active countries
"""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from db_models import User, UserSetting, UserActiveCountry, Country, get_session


class UserConfig:
    """Helper class for loading user-specific configuration"""
    
    def __init__(self, user_id: int, db_path: str = None):
        """Initialize user config
        
        Args:
            user_id: User ID to load config for
            db_path: Path to SQLite database file (for SQLite) or None to use DATABASE_URL env var
        """
        self.user_id = user_id
        self.session = get_session(db_path)
        self._user = None
        self._settings = None
        self._active_countries = None
    
    def get_user(self) -> Optional[User]:
        """Get user object
        
        Returns:
            User object or None if not found
        """
        if self._user is None:
            self._user = self.session.query(User).filter_by(id=self.user_id).first()
        return self._user
    
    def get_settings(self) -> Dict[str, str]:
        """Get user settings as a dictionary
        
        Returns:
            Dict of setting key -> value
        """
        if self._settings is None:
            user_settings = self.session.query(UserSetting).filter_by(userId=self.user_id).all()
            self._settings = {s.key: s.value for s in user_settings}
        return self._settings
    
    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        """Get a specific user setting
        
        Args:
            key: Setting key
            default: Default value if setting not found
            
        Returns:
            Setting value or default
        """
        settings = self.get_settings()
        return settings.get(key, default)
    
    def get_active_countries(self) -> List[str]:
        """Get list of active country codes for this user
        
        Returns:
            List of country codes (e.g., ['us', 'de', 'fr'])
        """
        if self._active_countries is None:
            active_country_records = self.session.query(UserActiveCountry).filter_by(
                userId=self.user_id
            ).join(Country).all()
            
            self._active_countries = [
                record.country.code.lower() 
                for record in active_country_records 
                if record.country
            ]
        return self._active_countries
    
    def close(self):
        """Close database session"""
        self.session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def load_user_config(user_id: int, db_path: str = None) -> Dict:
    """Load user configuration and return as a dict
    
    Args:
        user_id: User ID to load config for
        db_path: Path to SQLite database file (for SQLite) or None to use DATABASE_URL env var
        
    Returns:
        Dict with keys: user, settings, active_countries
    """
    with UserConfig(user_id, db_path) as config:
        user = config.get_user()
        if not user:
            raise ValueError(f"User with ID {user_id} not found")
        
        return {
            'user': user,
            'settings': config.get_settings(),
            'active_countries': config.get_active_countries()
        }
