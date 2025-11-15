# Configuration Hierarchy Documentation

**Last Updated:** 2025-01-15

This document explains the configuration hierarchy and rules for credential/setting management in the concert tracker system.

---

## 📋 Configuration Rules

### Per-User Settings (UserSetting table)

These settings are **ALWAYS user-specific** and should **NEVER** be global:

| Setting | Scope | Description |
|---------|-------|-------------|
| `LASTFM_USER` | **User-only** | Last.fm username for this specific user. Each user has their own Last.fm account. |
| `MIN_PLAYCOUNT` | **User-only** | Minimum playcount threshold for filtering artists. Each user has different listening patterns. |
| `LASTFM_API_KEY` | User or Global | User can have their own API key, or fall back to global shared key. |

### Global Settings (Setting table)

These settings are **ALWAYS global** and shared across all users:

| Setting | Scope | Description |
|---------|-------|-------------|
| `FANART_API_KEY` | **Global-only** | Fanart.tv API key is a shared resource for all users. |
| `LASTFM_API_KEY` | Global (fallback) | Global Last.fm API key used as fallback if user doesn't have their own. |

### Hybrid Settings

| Setting | Priority | Description |
|---------|----------|-------------|
| `LASTFM_API_KEY` | User → Global | Check UserSetting first, fall back to global Setting if not found. |

---

## 🔄 Configuration Loading Flow

### User-Specific Mode (Required)

When `--user-id` is provided (always required):

```
1. Load UserSetting for user
   ├─ LASTFM_USER ────────────> From UserSetting (REQUIRED)
   ├─ MIN_PLAYCOUNT ──────────> From UserSetting (default: 1)
   └─ LASTFM_API_KEY ─────────> From UserSetting OR global Setting

2. Load Global Settings
   └─ FANART_API_KEY ─────────> From global Setting (shared)

3. Load UserActiveCountry
   └─ Country codes ──────────> From UserActiveCountry table
```

**Example:**
```python
credentials, validation = load_credentials(user_id=1)

# User-specific values
credentials.lastfm_user      # From UserSetting (user1's Last.fm username)
credentials.min_playcount    # From UserSetting (user1's threshold)

# Hybrid: user-specific or global fallback
credentials.lastfm_api_key   # UserSetting OR global Setting

# Always global
credentials.fanart_api_key   # Global Setting (shared)
```

**Note:** Both modes are fully supported. Use user-specific mode for per-user concert filtering, or global mode for refreshing all artists and administrative tasks.

---

## 🏗️ Implementation

### Credential Loading (utils/credentials.py)

```python
from utils.credentials import load_credentials

# User-specific mode (recommended)
credentials, validation = load_credentials(
    user_id=1,
    db_path="data/db.sqlite",
    require_lastfm=False,
    require_countries=True
)

if validation.is_error():
    print(validation)  # Error + suggestions
    return 1

# Use credentials
if credentials.has_lastfm():
    service = LastFMService(credentials.lastfm_api_key)
    artists = service.fetch_top_artists(credentials.lastfm_user)

# Global mode (for all concerts/artists, admin tasks)
credentials, validation = load_credentials(
    db_path="data/db.sqlite",
    require_countries=True
)
# All credentials from global Setting table
```

### UserCredentials Dataclass

```python
@dataclass
class UserCredentials:
    user_id: Optional[int]          # User ID or None (global mode)
    username: Optional[str]          # Username or None
    lastfm_api_key: Optional[str]    # User or global API key
    lastfm_user: Optional[str]       # ALWAYS user-specific
    fanart_api_key: Optional[str]    # ALWAYS global
    min_playcount: int               # ONLY user-specific
    country_codes: list              # User-specific or global
    settings: Dict[str, str]         # Raw settings dict

    def has_lastfm() -> bool
    def has_fanart() -> bool
```

---

## 📊 Configuration Matrix

| Setting | Source | Lookup |
|---------|--------|--------|
| `LASTFM_USER` | User-specific | UserSetting (required) |
| `LASTFM_API_KEY` | Hybrid | UserSetting → Global Setting fallback |
| `MIN_PLAYCOUNT` | User-specific | UserSetting (default: 1) |
| `FANART_API_KEY` | Global | Global Setting (shared) |
| Country codes | User-specific | UserActiveCountry table |

---

## 🔧 Scripts Using Credentials

All scripts now use the centralized `load_credentials()` function (refactored as of 2025-01-15):

1. **parse_concerts.py** - Concert parser ✅
   - With `--user-id`: Filters by user's artists
   - Without `--user-id`: Gets all concerts (global mode)
   - Uses `load_credentials()` for both modes

2. **fetch_metadata.py** - Metadata fetcher ✅
   - With `--user-id`: Updates user-specific playcounts
   - Without `--user-id`: Refreshes all artists (global mode)
   - Uses `load_credentials()` for both modes

3. **services/metadata.py** - Metadata service functions ✅
   - Called by parse_concerts.py
   - Uses `load_credentials()` for consistent credential loading

---

## ✅ Best Practices

### DO: Always use load_credentials() with user_id
```python
# CORRECT - Load credentials for specific user
credentials, validation = load_credentials(user_id=1)

# User-specific settings
lastfm_user = credentials.lastfm_user        # ✅ From UserSetting
min_playcount = credentials.min_playcount    # ✅ From UserSetting

# Hybrid setting (user → global fallback)
lastfm_api_key = credentials.lastfm_api_key  # ✅ UserSetting or global

# Always global
fanart_api_key = credentials.fanart_api_key  # ✅ Global Setting
```

### DON'T: Mix global and user-specific modes incorrectly
```python
# WRONG - Using global mode when user-specific filtering is needed
credentials = load_credentials()  # ❌ Won't filter by user's artists
# Use user-specific mode for per-user filtering
credentials = load_credentials(user_id=1)  # ✅ Correct
```

### DON'T: Access ConfigManager directly for user-specific settings
```python
# WRONG - Bypasses user-specific configuration
config = ConfigManager()
lastfm_user = config.get('LASTFM_USER')      # ❌ No user context
min_playcount = config.get_int('MIN_PLAYCOUNT')  # ❌ Not user-specific
```

---

## 🧪 Testing

Configuration rules are tested in:
- `tests/test_credentials.py` - Credential loading tests
- `tests/test_validation.py` - Validation logic tests

Run tests:
```bash
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_credentials.py
~/lastfm-parser/venv/bin/python concert-tracker/scripts/tests/test_validation.py
```

---

## 📝 Setup Checklist

For each new user:

- [ ] Create user account in User table
- [ ] Set `LASTFM_USER` in UserSetting (required for Last.fm features)
- [ ] Set `MIN_PLAYCOUNT` in UserSetting (default: 1)
- [ ] (Optional) Set `LASTFM_API_KEY` in UserSetting if user has their own key
- [ ] Configure active countries in UserActiveCountry table
- [ ] Ensure global `FANART_API_KEY` is set in Setting table (shared)
- [ ] Ensure global `LASTFM_API_KEY` is set as fallback (if not using per-user keys)
- [ ] Use `--user-id` parameter when running scripts

---

**See Also:**
- [CLAUDE.md](../CLAUDE.md) - Architecture guide
- [LASTFM_OPTIONAL_STATUS.md](LASTFM_OPTIONAL_STATUS.md) - Last.fm optional implementation status
