# Configuration Manager Implementation Guide

## Overview
Implement a centralized configuration management system that stores settings in the database with fallback to environment variables. Settings are managed via a singleton Python class and can be updated through a web UI.

---

## 1. Database Schema

### Add `Setting` Model to Prisma Schema

**File**: `concert-tracker/prisma/schema.mysql.prisma` and `concert-tracker/prisma/schema.sqlite.prisma`

```prisma
model Setting {
  id          Int      @id @default(autoincrement())
  key         String   @unique @db.VarChar(100)
  value       String   @db.Text
  valueType   String   @db.VarChar(20)  // 'string' | 'int' | 'bool' | 'json'
  description String?  @db.Text
  createdAt   Int
  updatedAt   Int

  @@index([key])
}
```

### Add `Setting` Model to SQLAlchemy

**File**: `concert-tracker/scripts/db_models.py`

```python
class Setting(Base):
    """Setting model for configuration management"""
    __tablename__ = 'Setting'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False)
    valueType = Column(String(20), nullable=False)  # 'string', 'int', 'bool', 'json'
    description = Column(Text, nullable=True)
    createdAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()))
    updatedAt = Column(Integer, nullable=False, default=lambda: int(datetime.utcnow().timestamp()), onupdate=lambda: int(datetime.utcnow().timestamp()))
    
    def __repr__(self):
        return f"<Setting(key='{self.key}', value='{self.value}', type='{self.valueType}')>"
```

---

## 2. Configuration Manager Class

### Create `config_manager.py`

**File**: `concert-tracker/scripts/config_manager.py`

**Key Features**:
- Singleton pattern (one instance per process)
- Three-tier fallback: DB → ENV → defaults
- In-memory caching with TTL (Time To Live)
- Cache invalidation method for UI updates
- Type-safe getters with automatic conversion
- Auto-migration on first access

**Class Structure**:

```python
class ConfigManager:
    """
    Singleton configuration manager with DB-first, ENV fallback strategy
    
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
    
    _instance = None
    _lock = threading.Lock()
    
    # Configuration keys with defaults
    DEFAULTS = {
        'LASTFM_API_KEY': ('', 'string', 'Last.fm API key'),
        'LASTFM_USER': ('', 'string', 'Last.fm username'),
        'COUNTRY_CODES': ('["tr","fr","de"]', 'json', 'Country codes to scan'),
        'MIN_PLAYCOUNT': ('40', 'int', 'Minimum playcount threshold'),
        'FANART_API_KEY': ('', 'string', 'Fanart.tv API key'),
        'WEBSHARE_PROXY_URL': ('', 'string', 'Webshare proxy download URL'),
    }
    
    def __new__(cls):
        """Singleton pattern with thread safety"""
        
    def __init__(self):
        """Initialize cache and DB connection"""
        
    def _ensure_settings_table(self):
        """Create Setting table if it doesn't exist"""
        
    def _migrate_from_env(self):
        """Auto-migrate ENV vars to DB on first run"""
        
    def get(self, key: str, default=None) -> str:
        """Get setting as string"""
        
    def get_int(self, key: str, default: int = 0) -> int:
        """Get setting as integer"""
        
    def get_bool(self, key: str, default: bool = False) -> bool:
        """Get setting as boolean"""
        
    def get_json(self, key: str, default=None) -> any:
        """Get setting as parsed JSON"""
        
    def get_list(self, key: str, default: list = None) -> list:
        """Get setting as list (convenience for JSON arrays)"""
        
    def set(self, key: str, value: any, value_type: str = None):
        """Set setting in DB and invalidate cache"""
        
    def invalidate_cache(self, key: str = None):
        """Invalidate cache (all keys or specific key)"""
        
    def get_all(self) -> dict:
        """Get all settings as dict"""
        
    def _get_from_db(self, key: str) -> tuple:
        """Internal: Get from DB, returns (value, value_type)"""
        
    def _get_from_env(self, key: str) -> str:
        """Internal: Get from ENV"""
        
    def _get_default(self, key: str) -> tuple:
        """Internal: Get default value and type"""
```

**Usage Example**:
```python
from config_manager import ConfigManager

config = ConfigManager()

# Get values with automatic type conversion
api_key = config.get('LASTFM_API_KEY')
min_playcount = config.get_int('MIN_PLAYCOUNT')
country_codes = config.get_list('COUNTRY_CODES')  # Returns ['tr', 'fr', 'de']

# Update setting (invalidates cache)
config.set('MIN_PLAYCOUNT', 50, 'int')
```

---

## 3. Refactor Existing Scripts

### Files to Update:

1. **`country_concert_parser.py`**
   - Replace all `os.getenv()` calls with `config.get()`
   - Lines to update: 783, 824, 835, 841, 845

2. **`fetch_artist_metadata.py`**
   - Replace all `os.getenv()` calls with `config.get()`
   - Lines to update: 115, 121, 127, 241, 247, 253

3. **`concert_utils.py`**
   - Update `fetch_lastfm_artists()` to accept config manager
   - No direct ENV access (receive values as parameters)

4. **`db_config.py`**
   - Keep as-is (handles DB connection, not app config)
   - Or optionally integrate with ConfigManager for consistency

### Refactoring Pattern:

**Before**:
```python
from dotenv import load_dotenv
load_dotenv()

lastfm_api_key = os.getenv('LASTFM_API_KEY')
min_playcount = int(os.getenv('MIN_PLAYCOUNT', '40'))
country_codes = os.getenv('COUNTRY_CODES', 'tr,fr,de').split(',')
```

**After**:
```python
from config_manager import ConfigManager

config = ConfigManager()

lastfm_api_key = config.get('LASTFM_API_KEY')
min_playcount = config.get_int('MIN_PLAYCOUNT')
country_codes = config.get_list('COUNTRY_CODES')
```

---

## 4. Web API Routes

### Create Settings API

**File**: `concert-tracker/app/api/settings/route.ts`

```typescript
// GET /api/settings - Get all settings
export async function GET() {
  const settings = await prisma.setting.findMany({
    orderBy: { key: 'asc' }
  });
  return NextResponse.json(settings);
}

// PATCH /api/settings - Update multiple settings
export async function PATCH(request: Request) {
  const updates = await request.json();
  // Update settings in DB
  // Call Python script to invalidate cache
  return NextResponse.json({ success: true });
}
```

**File**: `concert-tracker/app/api/settings/[key]/route.ts`

```typescript
// GET /api/settings/[key] - Get single setting
export async function GET(
  request: Request,
  { params }: { params: { key: string } }
) {
  const setting = await prisma.setting.findUnique({
    where: { key: params.key }
  });
  return NextResponse.json(setting);
}

// PUT /api/settings/[key] - Update single setting
export async function PUT(
  request: Request,
  { params }: { params: { key: string } }
) {
  const { value, valueType } = await request.json();
  const setting = await prisma.setting.update({
    where: { key: params.key },
    data: { 
      value, 
      valueType,
      updatedAt: Math.floor(Date.now() / 1000)
    }
  });
  
  // Invalidate Python cache via helper script
  await invalidatePythonCache(params.key);
  
  return NextResponse.json(setting);
}
```

### Cache Invalidation Helper

**File**: `concert-tracker/scripts/invalidate_cache.py`

```python
#!/usr/bin/env python3
"""
CLI tool to invalidate ConfigManager cache
Called by Next.js API after settings updates
"""

import sys
from config_manager import ConfigManager

if __name__ == '__main__':
    config = ConfigManager()
    
    if len(sys.argv) > 1:
        key = sys.argv[1]
        config.invalidate_cache(key)
        print(f"Cache invalidated for: {key}")
    else:
        config.invalidate_cache()
        print("All cache invalidated")
```

**Usage in Next.js**:
```typescript
import { spawn } from 'child_process';

async function invalidatePythonCache(key?: string) {
  return new Promise((resolve, reject) => {
    const args = key ? [key] : [];
    const process = spawn('python3', [
      '/app/scripts/invalidate_cache.py',
      ...args
    ]);
    
    process.on('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`Cache invalidation failed: ${code}`));
    });
  });
}
```

---

## 5. Web UI Components

### Settings Page

**File**: `concert-tracker/app/settings/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';

interface Setting {
  id: number;
  key: string;
  value: string;
  valueType: string;
  description: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch settings
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    setSaving(false);
  };

  // Render form based on valueType
  const renderInput = (setting: Setting) => {
    switch (setting.valueType) {
      case 'json':
        if (setting.key === 'COUNTRY_CODES') {
          return <CountryCodeEditor setting={setting} />;
        }
        return <textarea />;
      case 'int':
        return <input type="number" />;
      case 'bool':
        return <input type="checkbox" />;
      default:
        return <input type="text" />;
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1>Settings</h1>
      {/* Settings form */}
    </div>
  );
}
```

### Country Code Editor Component

**File**: `concert-tracker/app/settings/CountryCodeEditor.tsx`

```typescript
'use client';

interface Props {
  setting: Setting;
  onChange: (value: string[]) => void;
}

export default function CountryCodeEditor({ setting, onChange }: Props) {
  const codes = JSON.parse(setting.value) as string[];
  
  const addCode = (code: string) => {
    onChange([...codes, code.toLowerCase()]);
  };
  
  const removeCode = (index: number) => {
    onChange(codes.filter((_, i) => i !== index));
  };
  
  return (
    <div>
      {/* Tag-style editor for country codes */}
      <div className="flex flex-wrap gap-2">
        {codes.map((code, i) => (
          <span key={i} className="badge">
            {code.toUpperCase()}
            <button onClick={() => removeCode(i)}>×</button>
          </span>
        ))}
      </div>
      <input 
        type="text" 
        placeholder="Add country code (e.g., 'us')"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            addCode(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}
```

---

## 6. Migration Script

### Create Migration Helper

**File**: `concert-tracker/scripts/migrate_settings.py`

```python
#!/usr/bin/env python3
"""
One-time migration script to populate Setting table from .env
Can be run manually or automatically on first ConfigManager access
"""

from config_manager import ConfigManager

def migrate():
    config = ConfigManager()
    config._migrate_from_env()
    print("✅ Settings migrated from .env to database")
    
    # Display current settings
    all_settings = config.get_all()
    print("\nCurrent settings:")
    for key, value in all_settings.items():
        print(f"  {key}: {value}")

if __name__ == '__main__':
    migrate()
```

---

## 7. Implementation Steps

### Phase 1: Database Setup
1. ✅ Add `Setting` model to both Prisma schemas (MySQL + SQLite)
2. ✅ Run Prisma migration: `npx prisma migrate dev --name add_settings`
3. ✅ Add `Setting` model to `db_models.py`
4. ✅ Update `Base.metadata.create_all()` to include Setting table

### Phase 2: Python Config Manager
1. ✅ Create `config_manager.py` with full implementation
2. ✅ Implement singleton pattern with thread safety
3. ✅ Implement caching with TTL (60s default)
4. ✅ Implement three-tier fallback (DB → ENV → defaults)
5. ✅ Implement auto-migration on first access
6. ✅ Add type-safe getters (get, get_int, get_bool, get_json, get_list)
7. ✅ Add cache invalidation method

### Phase 3: Refactor Python Scripts
1. ✅ Update `country_concert_parser.py`
   - Import ConfigManager
   - Replace all `os.getenv()` calls
   - Update COUNTRY_CODES parsing (JSON array)
2. ✅ Update `fetch_artist_metadata.py`
   - Import ConfigManager
   - Replace all `os.getenv()` calls
3. ✅ Test all scripts with new config system

### Phase 4: Web API
1. ✅ Create `/api/settings/route.ts` (GET all, PATCH multiple)
2. ✅ Create `/api/settings/[key]/route.ts` (GET one, PUT one)
3. ✅ Create `invalidate_cache.py` helper script
4. ✅ Integrate cache invalidation in API routes

### Phase 5: Web UI
1. ✅ Create `/settings/page.tsx`
2. ✅ Create `CountryCodeEditor.tsx` component
3. ✅ Add navigation link to settings page
4. ✅ Test settings updates and cache invalidation

### Phase 6: Testing
1. ✅ Test auto-migration from ENV to DB
2. ✅ Test fallback chain (DB → ENV → defaults)
3. ✅ Test cache invalidation after UI updates
4. ✅ Test concurrent access (threading)
5. ✅ Test with both MySQL and SQLite

---

## 8. Technical Considerations

### Cache Invalidation Strategy
- **Problem**: Python process (scanner) caches settings, but Next.js updates DB
- **Solution**: Next.js calls `invalidate_cache.py` after updates
- **Alternative**: Use Redis/shared cache (overkill for this use case)
- **Trade-off**: Scanner must restart to pick up changes (acceptable)

### Thread Safety
- Use `threading.Lock()` for singleton initialization
- Cache is process-local (not shared between processes)
- Each Python script instance has its own cache

### Database Schema Flexibility
- Key-value design allows adding settings without migrations
- Type hints enable proper conversion
- Description field for UI tooltips

### ENV Fallback Benefits
- Backward compatibility with existing deployments
- Docker secrets can still use ENV vars
- Development can use .env without DB

---

## 9. Future Enhancements

### Not in Initial Implementation
1. **Setting Groups**: Group related settings (e.g., "Last.fm", "Proxies")
2. **Validation**: Add validation rules (e.g., regex for API keys)
3. **Encryption**: Encrypt sensitive values (API keys) in DB
4. **Audit Log**: Track who changed what and when
5. **Setting Presets**: Save/load setting configurations
6. **Hot Reload**: Real-time updates without restart (complex)

---

## 10. Code Examples

### Example: Using ConfigManager in Parser

```python
from config_manager import ConfigManager

class CountryConcertParser:
    def __init__(self, ...):
        self.config = ConfigManager()
        
        # Get settings with proper types
        self.lastfm_api_key = self.config.get('LASTFM_API_KEY')
        self.min_playcount = self.config.get_int('MIN_PLAYCOUNT')
        self.country_codes = self.config.get_list('COUNTRY_CODES')
        
        # Use settings
        if not self.lastfm_api_key:
            raise ValueError("LASTFM_API_KEY not configured")
```

### Example: Updating Settings from UI

```typescript
// Update MIN_PLAYCOUNT
await fetch('/api/settings/MIN_PLAYCOUNT', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    value: '50',
    valueType: 'int'
  })
});

// Update COUNTRY_CODES
await fetch('/api/settings/COUNTRY_CODES', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    value: JSON.stringify(['ge', 'tr', 'fr', 'de', 'es', 'us']),
    valueType: 'json'
  })
});
```

---

## 11. Testing Checklist

- [ ] Setting table created in both MySQL and SQLite
- [ ] Auto-migration populates DB from .env on first run
- [ ] ConfigManager returns correct values with type conversion
- [ ] Fallback chain works (DB → ENV → defaults)
- [ ] Cache invalidation works after DB updates
- [ ] Settings API routes work (GET, PUT, PATCH)
- [ ] Settings UI displays and updates correctly
- [ ] Country code editor adds/removes codes
- [ ] Scanner picks up new settings after restart
- [ ] No performance degradation (caching works)

---

## Summary

This implementation provides:
- ✅ Centralized configuration management
- ✅ Database-first with ENV fallback
- ✅ Type-safe access with caching
- ✅ Web UI for easy updates
- ✅ Backward compatible with existing ENV setup
- ✅ Extensible for future settings

**Estimated Implementation Time**: 4-6 hours
**Files to Create**: 5 new files
**Files to Modify**: 4 existing files
**Database Changes**: 1 new table
