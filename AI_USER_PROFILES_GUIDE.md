# AI Implementation Guide: User Profiles & Authentication

## Overview
This guide provides an agent-friendly, step-by-step plan to introduce multi-user profiles, authentication, role-based access, and per-user settings into the concert tracker stack (Next.js 15 + Prisma + Python parser).

- **Auth stack**: NextAuth (Auth.js) with credentials provider and bcrypt hashing
- **Roles**: `admin`, `user`
- **Settings split**: Global (admin-controlled) vs per-user overrides
- **Default user settings**: `MIN_PLAYCOUNT=1`, blank `LASTFM_*`, all countries inactive
- **Per-user data**: Interested concerts, notes, artist metrics, active countries, Last.fm credentials
- **Scanner**: each user may run at most one active scan; multiple users can scan simultaneously
- **Audit logging**: required for changes to global settings

## Phase 1 – Data Layer Foundations ✅ COMPLETED

**Status:** All schema changes applied, data migrated, redundant columns removed.

### Prisma Schema Changes (DONE)
1. **New Enum & Models**
   ```prisma
   enum Role {
     USER
     ADMIN
   }

   model User {
     id             Int       @id @default(autoincrement())
     username       String    @unique
     hashedPassword String
     role           Role      @default(USER)
     createdAt      Int
     updatedAt      Int

     settings       UserSetting[]
     concerts       UserConcert[]
     artists        UserArtist[]
     activeCountries UserActiveCountry[]
     auditLogs      SettingAuditLog[]
   }

   model UserSetting {
     id        Int    @id @default(autoincrement())
     userId    Int
     key       String
     value     String
     valueType String
     createdAt Int
     updatedAt Int

     user User @relation(fields: [userId], references: [id])

     @@unique([userId, key])
   }

   model UserConcert {
     id        Int     @id @default(autoincrement())
     userId    Int
     concertId Int
     interested Boolean @default(false)
     notes     String?
     createdAt Int
     updatedAt Int

     user    User    @relation(fields: [userId], references: [id])
     concert Concert @relation(fields: [concertId], references: [id])

     @@unique([userId, concertId])
   }

   model UserArtist {
     id              Int   @id @default(autoincrement())
     userId          Int
     artistId        Int
     playcount       Int   @default(0)
     playcount12month Int  @default(0)
     recent          Boolean @default(false)
     createdAt       Int
     updatedAt       Int

     user   User   @relation(fields: [userId], references: [id])
     artist Artist @relation(fields: [artistId], references: [id])

     @@unique([userId, artistId])
   }

   model UserActiveCountry {
     id        Int @id @default(autoincrement())
     userId    Int
     countryId Int
     createdAt Int

     user    User    @relation(fields: [userId], references: [id])
     country Country @relation(fields: [countryId], references: [id])

     @@unique([userId, countryId])
   }

   model SettingAuditLog {
     id        Int    @id @default(autoincrement())
     userId    Int
     key       String
     oldValue  String?
     newValue  String
     createdAt Int

     user User @relation(fields: [userId], references: [id])

     @@index([key])
   }
   ```

2. **Concert & Artist Adjustments**
   - Remove `interested` and `notes` from `Concert`.
   - Add relations: `Concert.userInteractions UserConcert[]`, `Artist.userStats UserArtist[]`.

3. **Country Model**
   - Retain `active` temporarily for migration; schedule removal once per-user data is migrated.

4. **SQLite Schema**
   - Mirror identical changes in `schema.sqlite.prisma` to preserve DB switching support.

### SQLAlchemy Model Updates
- Extend `scripts/db_models.py` with matching `User`, `UserSetting`, `UserConcert`, `UserArtist`, `UserActiveCountry`, and `SettingAuditLog` classes.
- Remove concert-level `interested/notes`; parser should interact via `UserConcert` for user-specific operations.

### Migration Strategy (COMPLETED)

**Executed Migration Scripts:**
1. **`migrate_to_user_profiles.py`** - Created admin user, default settings, migrated active countries
   - Admin user: `admin` / `admin123` (ID: 1)
   - Default settings: MIN_PLAYCOUNT=1, LASTFM_USER='', LASTFM_API_KEY=''
   - Migrated 2 active countries to UserActiveCountry

2. **`migrate_artist_data.py`** - Restored artist metrics from backup database
   - Migrated 55 artist records to UserArtist
   - Total playcount: 29,112
   - Uses backup database with MySQL backticks for db names with hyphens

3. **`migrate_concert_data.py`** - Restored concert interactions from backup
   - Migrated 2 concert interaction records to UserConcert
   - Matches concerts by eventUrl (unique identifier)

4. **`cleanup_redundant_columns.py`** - Removed obsolete columns
   - Dropped Artist.playcount, playcount12month, recent
   - Dropped Country.active
   - Database now matches Prisma schema exactly

**MySQL-Specific Notes:**
- Backup database permissions: `GRANT ALL PRIVILEGES ON \`concerts-backup\`.* TO 'concertuser'@'%'`
- Use backticks for database names with hyphens: `` \`concerts-backup\` ``
- All Python scripts use venv: `source venv/bin/activate`

### Actual Migration Results

**Database State After Phase 1:**
- ✅ All new tables created (User, UserSetting, UserConcert, UserArtist, UserActiveCountry, SettingAuditLog)
- ✅ Admin user configured and functional
- ✅ Artist metrics migrated to per-user table
- ✅ Concert interactions migrated to per-user table
- ✅ Redundant columns removed from Artist and Country tables
- ✅ Schema matches Prisma models exactly

**Current Schema:**
- `Artist`: id, name, mbid, imageUrl (shared data only)
- `Country`: id, name, code, createdAt, updatedAt (shared data only)
- `UserArtist`: userId, artistId, playcount, playcount12month, recent (per-user metrics)
- `UserActiveCountry`: userId, countryId (per-user country activation)
- `UserConcert`: userId, concertId, interested, notes (per-user interactions)

## Phase 2 – Authentication & Role Enforcement ✅ COMPLETED

### NextAuth v5 (Auth.js) Configuration
1. **Dependencies**
   ```bash
   npm install next-auth@5.0.0-beta.25 bcryptjs
   npm install -D @types/bcryptjs
   ```
   **IMPORTANT:** Use `bcryptjs` (pure JavaScript) instead of `bcrypt` (native module) for Next.js Edge runtime compatibility in middleware.
   
   Note: NextAuth v5 is designed for Next.js 15 App Router. No adapter needed for credentials provider.

2. **Environment Variables** (add to `.env`) ✅ DONE
   ```bash
   # Generate with: openssl rand -base64 32
   AUTH_SECRET="562uEQ8ut3L/ujXaHVIn724DJFazPy0PGBQpMwdgpUs="
   AUTH_URL="http://localhost:3000"  # or production URL
   ```

3. **Auth Configuration** (`concert-tracker/auth.ts`) ✅ DONE
   ```ts
   import NextAuth from 'next-auth';
   import Credentials from 'next-auth/providers/credentials';
   import bcrypt from 'bcryptjs';  // Use bcryptjs for Edge compatibility
   import { prisma } from '@/lib/prisma';

   export const { handlers, signIn, signOut, auth } = NextAuth({
     providers: [
       Credentials({
         credentials: {
           username: { label: 'Username', type: 'text' },
           password: { label: 'Password', type: 'password' }
         },
         async authorize(credentials) {
           if (!credentials?.username || !credentials?.password) return null;
           
           const user = await prisma.user.findUnique({ 
             where: { username: credentials.username as string } 
           });
           
           if (!user) return null;
           
           const valid = await bcrypt.compare(
             credentials.password as string, 
             user.hashedPassword
           );
           
           if (!valid) return null;
           
           return {
             id: user.id.toString(),
             name: user.username,
             role: user.role,
           };
         }
       })
     ],
     callbacks: {
       async jwt({ token, user }) {
         if (user) {
           token.id = user.id;
           token.role = user.role;
         }
         return token;
       },
       async session({ session, token }) {
         if (session.user) {
           session.user.id = token.id as string;
           session.user.role = token.role as string;
         }
         return session;
       }
     },
     pages: {
       signIn: '/login',
     },
   });
   ```

4. **Route Handlers** (`app/api/auth/[...nextauth]/route.ts`) ✅ DONE
   ```ts
   import { handlers } from '@/auth';
   export const { GET, POST } = handlers;
   ```

5. **Type Definitions** (`concert-tracker/types/next-auth.d.ts`) ✅ DONE
   ```ts
   import { DefaultSession } from 'next-auth';

   declare module 'next-auth' {
     interface Session {
       user: {
         id: string;
         role: string;
       } & DefaultSession['user'];
     }

     interface User {
       role: string;
     }
   }

   declare module '@auth/core/jwt' {
     interface JWT {
       id: string;
       role: string;
     }
   }
   ```

6. **Using Auth in Server Components**
   ```ts
   import { auth } from '@/auth';

   export default async function ProtectedPage() {
     const session = await auth();
     if (!session) redirect('/login');
     
     const userId = parseInt(session.user.id);
     const isAdmin = session.user.role === 'ADMIN';
     // ...
   }
   ```

7. **Using Auth in API Routes**
   ```ts
   import { auth } from '@/auth';

   export async function GET() {
     const session = await auth();
     if (!session) return new Response('Unauthorized', { status: 401 });
     
     const userId = parseInt(session.user.id);
     // ...
   }
   ```

### Login Page (`app/login/page.tsx` + `LoginForm.tsx`) ✅ DONE
- Server component checks if user is already logged in and redirects
- Client component handles form submission with error states
- Uses Next.js 15 async searchParams pattern
- Redirects to callbackUrl after successful login
- Shows default admin credentials for convenience

**Future OAuth Support:**
To add Google/GitHub later, simply add providers to the array:
```ts
Providers: [
  Credentials({ /* ... */ }),
  Google({ clientId: process.env.GOOGLE_ID, clientSecret: process.env.GOOGLE_SECRET }),
  GitHub({ clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET }),
]
```

### Password Handling
- Store hashed passwords using `bcrypt.hash(password, 12)` when admins create/reset user credentials.
- Use `bcryptjs` for all password operations (Edge runtime compatible)
- Enforce minimal client-side validation: length ≥ 8, mix of characters.
- Rate-limit login requests (middleware or edge function) to reduce brute-force risk.

---

## ⚠️ CRITICAL: Temporary Feature Disabling During Migration

**IMPORTANT:** During Phase 1-2, we removed columns from the database schema that were migrated to user-specific tables:
- `Concert.interested` → moved to `UserConcert.interested`
- `Concert.notes` → moved to `UserConcert.notes`
- `Artist.playcount` → moved to `UserArtist.playcount`
- `Artist.playcount12months` → moved to `UserArtist.playcount12months`
- `Artist.recent` → moved to `UserArtist.recent`

**Features Temporarily Disabled:**
1. **Home page concert ordering by 'interested' flag** - Removed from `app/page.tsx`
2. **Concert detail page interested/notes functionality** - Needs UserConcert integration
3. **Artist popularity/playcount display** - Needs UserArtist integration
4. **All concert/artist filtering and sorting** - Needs user-specific data

**These features will be restored in Phase 6.5 (UI Feature Restoration) after all backend changes are complete.**

---

### Session Middleware (`concert-tracker/middleware.ts`) ✅ DONE
```ts
import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Always allow login and auth routes
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // All other routes require authentication
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes
  const adminRoutes = ['/admin', '/api/settings/global', '/api/settings/audit'];
  const isAdminRoute = adminRoutes.some(route => pathname.startsWith(route));
  
  if (isAdminRoute && session.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

---

## Phase 3 – Settings Refactor & Audit Logging ✅ COMPLETE

### Implementation Summary

**Completed Features:**
- ✅ Split settings API into global (admin) and user-specific endpoints
- ✅ Implemented audit logging for global settings changes
- ✅ Created per-user country management with `UserActiveCountry` table
- ✅ Removed global `Country.active` field (now 100% per-user)
- ✅ Built tabbed settings UI with role-based access
- ✅ Added Countries tab with search, add, activate/deactivate, and delete (admin)

**API Endpoints Created:**
- `app/api/settings/global/route.ts` - Admin-only global settings (GET/PATCH with audit logging)
- `app/api/settings/user/route.ts` - Per-user settings (GET/PATCH)
- `app/api/settings/audit/route.ts` - Admin-only audit log viewer (GET with pagination)
- `app/api/settings/user-countries/route.ts` - Per-user country management (GET/POST/PATCH/DELETE)

**UI Components:**
- `app/settings/page.tsx` - Server component with auth check and role detection
- `app/settings/SettingsClient.tsx` - Client component with tabbed interface
- `app/settings/CountriesTab.tsx` - Country management UI with search and filtering

**Tab Structure:**
1. **My Settings** (all users, default) - Personal Last.fm credentials
2. **Countries** (all users) - Add, activate/deactivate countries for scanning
3. **Admin Settings** (admins only) - System-wide configuration

**Database Migration Applied:**
```sql
-- Dropped Country.active column (no longer needed)
DROP INDEX `Country_active_idx` ON `Country`;
ALTER TABLE `Country` DROP COLUMN `active`;
```

**Python Scripts Updated:**
- `add_country.py` - Removed active parameter, simplified messages
- `country_helper.py` - Removed active field from Country creation
- `db_models.py` - Removed active column from SQLAlchemy model

**Key Implementation Details:**
- Country deletion checks for UserActiveCountry records and deletes them first
- Countries added via UI are auto-activated for the adding user
- Search is case-insensitive and filters by both name and code
- Active countries displayed first in the list with visual indicators

### Original Requirements:

1. **Split Settings API**
   
   **`app/api/settings/global/route.ts`** (NEW - admin only)
   ```ts
   import { auth } from '@/auth';
   import { prisma } from '@/lib/prisma';

   export async function GET() {
     const session = await auth();
     if (!session || session.user.role !== 'ADMIN') {
       return new Response('Forbidden', { status: 403 });
     }

     const settings = await prisma.setting.findMany({
       orderBy: { key: 'asc' }
     });
     return Response.json(settings);
   }

   export async function PATCH(request: Request) {
     const session = await auth();
     if (!session || session.user.role !== 'ADMIN') {
       return new Response('Forbidden', { status: 403 });
     }

     const updates = await request.json();
     const userId = parseInt(session.user.id);
     const now = Math.floor(Date.now() / 1000);

     for (const { key, value, valueType } of updates) {
       // Get old value for audit log
       const oldSetting = await prisma.setting.findUnique({ where: { key } });
       
       // Update setting
       await prisma.setting.update({
         where: { key },
         data: { value: String(value), valueType, updatedAt: now }
       });

       // Create audit log entry
       await prisma.settingAuditLog.create({
         data: {
           userId,
           key,
           oldValue: oldSetting?.value || null,
           newValue: String(value),
           createdAt: now
         }
       });
     }

     return Response.json({ success: true });
   }
   ```

   **`app/api/settings/user/route.ts`** (NEW - per-user settings)
   ```ts
   import { auth } from '@/auth';
   import { prisma } from '@/lib/prisma';

   export async function GET() {
     const session = await auth();
     if (!session) return new Response('Unauthorized', { status: 401 });

     const userId = parseInt(session.user.id);
     const userSettings = await prisma.userSetting.findMany({
       where: { userId }
     });

     // Merge with defaults
     const defaults = [
       { key: 'MIN_PLAYCOUNT', value: '1', valueType: 'int' },
       { key: 'LASTFM_USER', value: '', valueType: 'string' },
       { key: 'LASTFM_API_KEY', value: '', valueType: 'string' },
     ];

     const merged = defaults.map(def => {
       const userSetting = userSettings.find(s => s.key === def.key);
       return userSetting || def;
     });

     return Response.json(merged);
   }

   export async function PUT(request: Request) {
     const session = await auth();
     if (!session) return new Response('Unauthorized', { status: 401 });

     const userId = parseInt(session.user.id);
     const updates = await request.json();
     const now = Math.floor(Date.now() / 1000);

     for (const { key, value, valueType } of updates) {
       await prisma.userSetting.upsert({
         where: { userId_key: { userId, key } },
         update: { value: String(value), valueType, updatedAt: now },
         create: { userId, key, value: String(value), valueType, createdAt: now, updatedAt: now }
       });
     }

     return Response.json({ success: true });
   }
   ```

2. **Update Countries API** (`app/api/settings/countries/route.ts`)
   - Change to use `UserActiveCountry` instead of `Country.active`
   - GET: return user's active countries
   - POST: add country to user's active list
   - DELETE: remove from user's active list (admins can delete Country entirely)

3. **Audit Log Endpoint** (`app/api/settings/audit/route.ts`)
   ```ts
   import { auth } from '@/auth';
   import { prisma } from '@/lib/prisma';

   export async function GET(request: Request) {
     const session = await auth();
     if (!session || session.user.role !== 'ADMIN') {
       return new Response('Forbidden', { status: 403 });
     }

     const { searchParams } = new URL(request.url);
     const key = searchParams.get('key');
     const userId = searchParams.get('userId');
     const limit = parseInt(searchParams.get('limit') || '50');
     const offset = parseInt(searchParams.get('offset') || '0');

     const logs = await prisma.settingAuditLog.findMany({
       where: {
         ...(key && { key }),
         ...(userId && { userId: parseInt(userId) })
       },
       include: { user: { select: { username: true } } },
       orderBy: { createdAt: 'desc' },
       take: limit,
       skip: offset
     });

     return Response.json(logs);
   }
   ```

### Frontend Adjustments

**Refactor `app/settings/page.tsx`:**

1. **Add Session Check**
   ```tsx
   import { auth } from '@/auth';
   import { redirect } from 'next/navigation';

   export default async function SettingsPage() {
     const session = await auth();
     if (!session) redirect('/login');

     const userId = parseInt(session.user.id);
     const isAdmin = session.user.role === 'ADMIN';
     // ...
   }
   ```

2. **Split into Tabs/Sections**
   - "My Settings" - always visible, loads from `/api/settings/user`
   - "Active Countries" - always visible, loads user's active countries
   - "Global Settings" - admin only, loads from `/api/settings/global`
   - "Audit Log" - admin only, loads from `/api/settings/audit`

3. **Update Countries Management**
   - Change API calls from `/api/settings/countries` to use user context
   - POST: adds to UserActiveCountry for current user
   - DELETE: removes from UserActiveCountry (or deletes Country if admin)
   - Remove global `active` toggle (now per-user)

4. **Add Audit Log View** (admin only)
   ```tsx
   <div className="mt-8">
     <h2>Global Settings Audit Log</h2>
     <table>
       <thead>
         <tr>
           <th>Timestamp</th>
           <th>User</th>
           <th>Setting</th>
           <th>Old Value</th>
           <th>New Value</th>
         </tr>
       </thead>
       <tbody>
         {auditLogs.map(log => (
           <tr key={log.id}>
             <td>{new Date(log.createdAt * 1000).toLocaleString()}</td>
             <td>{log.user.username}</td>
             <td>{log.key}</td>
             <td>{log.oldValue || 'N/A'}</td>
             <td>{log.newValue}</td>
           </tr>
         ))}
       </tbody>
     </table>
   </div>
   ```

## Phase 4 – Concert & Artist Data Flow

### API Updates
- Modify server-side data fetching to include user context:
  ```ts
  const concerts = await prisma.concert.findMany({
    include: {
      userInteractions: {
        where: { userId: sessionUserId }
      }
    }
  });
  ```
  Merge `interested/notes` from `UserConcert` before returning to UI.

- Update `/api/concerts/[id]` PATCH to upsert into `UserConcert`:
  ```ts
  await prisma.userConcert.upsert({
    where: { userId_concertId: { userId, concertId } },
    update: { interested, notes, updatedAt: now },
    create: { userId, concertId, interested, notes, createdAt: now, updatedAt: now }
  });
  ```

- Artist endpoints include both shared data and optional per-user overlay from `UserArtist`.

### Python Parser Compatibility

**Parser runs per-user, loading settings from database:**

#### Required Script Updates

1. **`country_concert_parser.py`** - Main parser script
   - **Add `--user-id` CLI argument** (required when run from scanner)
   - **`load_user_settings(session, user_id)`** - Load UserSetting records instead of env vars
   - **`get_active_countries(session, user_id)`** - Query UserActiveCountry instead of Country.active
   - **Update artist metrics** - Write to UserArtist table instead of Artist table
   - **Fallback to env vars** - When `--user-id` not provided (standalone/debug mode)

2. **`fetch_artist_metadata.py`** - Artist metadata fetcher
   - **Add `--user-id` CLI argument** (optional)
   - **Update artist metrics** - If user_id provided, write to UserArtist; otherwise skip metrics
   - **Keep shared data updates** - Continue updating Artist.mbid, Artist.imageUrl (shared)

3. **`db_writer.py`** - Database writer utilities
   - **`upsert_artist_metrics(session, user_id, artist_id, playcount, ...)`** - New function for UserArtist
   - **Keep `upsert_artist(session, artist_data)`** - For shared artist data (name, mbid, imageUrl)
   - **No changes to concert writing** - Concerts remain shared

4. **`config_manager.py`** - Configuration loader
   - **`load_user_config(session, user_id)`** - New function to load UserSetting records
   - **`get_user_active_countries(session, user_id)`** - New function for UserActiveCountry
   - **Keep existing env-based config** - For backward compatibility

5. **No changes required:**
   - `db_models.py` - Already updated in Phase 1
   - `country_helper.py` - Country resolution logic unchanged
   - `city_normalizer.py` - City normalization unchanged
   - `db_config.py` - Database connection unchanged
   - `proxy_manager.py` - Proxy management unchanged
   - `concert_utils.py` - Utility functions unchanged

#### Example Implementation Snippets

**`country_concert_parser.py` - User settings loader:**
```python
def load_user_settings(session, user_id):
    """Load user-specific settings from database"""
    settings = session.query(UserSetting).filter_by(userId=user_id).all()
    config = {s.key: s.value for s in settings}
    
    # Get active countries for this user
    active_countries = session.query(UserActiveCountry).filter_by(userId=user_id).all()
    country_ids = [ac.countryId for ac in active_countries]
    
    return config, country_ids

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user-id', type=int, help='User ID for per-user settings')
    args = parser.parse_args()
    
    if args.user_id:
        # Load from database
        config, country_ids = load_user_settings(session, args.user_id)
        lastfm_user = config.get('LASTFM_USER')
        lastfm_api_key = config.get('LASTFM_API_KEY')
        min_playcount = int(config.get('MIN_PLAYCOUNT', 1))
    else:
        # Fallback to environment variables (debug/standalone)
        lastfm_user = os.getenv('LASTFM_USER')
        lastfm_api_key = os.getenv('LASTFM_API_KEY')
        min_playcount = int(os.getenv('MIN_PLAYCOUNT', 1))
        country_ids = get_country_ids_from_env()
```

**`db_writer.py` - User artist metrics:**
```python
def upsert_user_artist_metrics(session, user_id, artist_id, playcount, playcount12month, recent):
    """Update per-user artist metrics"""
    now = int(datetime.utcnow().timestamp())
    
    existing = session.query(UserArtist).filter_by(
        userId=user_id, artistId=artist_id
    ).first()
    
    if existing:
        existing.playcount = playcount
        existing.playcount12month = playcount12month
        existing.recent = recent
        existing.updatedAt = now
    else:
        user_artist = UserArtist(
            userId=user_id,
            artistId=artist_id,
            playcount=playcount,
            playcount12month=playcount12month,
            recent=recent,
            createdAt=now,
            updatedAt=now
        )
        session.add(user_artist)
```

#### Migration Strategy for Python Scripts

**Phase 4 Implementation Order:**
1. Update `config_manager.py` with user settings loaders
2. Update `db_writer.py` with UserArtist upsert functions
3. Update `country_concert_parser.py` to use new loaders
4. Update `fetch_artist_metadata.py` for optional user context
5. Test standalone mode (env vars) still works
6. Test scanner mode (--user-id) with database settings

## Phase 5 – Admin & User Workflows

### Admin Tools
- **User Management Page**
  - List users with role badges, created date, "Reset Password" button.
  - Form to create a new user (username, temporary password, role).
- **Audit Viewer**
  - Data table pulling from `/api/settings/audit`.

### User Onboarding Flow
- After admin creates user, prompt them to change password on first login (optional) or rely on admin-supplied credentials.
- Wizard on first login: configure Last.fm credentials, set minimum playcount, choose active countries.

## Phase 6 – Scanner Enhancements

### Backend Updates

**Refactor `app/api/scanner/start/route.ts`:**

```ts
import { auth } from '@/auth';
import { spawn } from 'child_process';

// Track active scans per user (in-memory)
const activeScans = new Map<number, { pid: number, startTime: number }>();

export async function POST() {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);

  // Check if user already has an active scan
  if (activeScans.has(userId)) {
    return Response.json(
      { error: 'You already have an active scan running', scanInfo: activeScans.get(userId) },
      { status: 409 }
    );
  }

  // Spawn parser with user ID (settings loaded from DB)
  const process = spawn('python', [
    '/app/scripts/country_concert_parser.py',
    '--user-id', userId.toString(),
    // No env vars needed - parser loads from DB
  ]);

  // Track the scan
  activeScans.set(userId, {
    pid: process.pid!,
    startTime: Date.now()
  });

  // Clean up when process exits
  process.on('exit', () => {
    activeScans.delete(userId);
  });

  return Response.json({ 
    success: true, 
    pid: process.pid,
    message: 'Scanner started with your personal settings'
  });
}
```

**Update `app/api/scanner/stop/route.ts`:**
```ts
import { auth } from '@/auth';

export async function POST() {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);
  const scanInfo = activeScans.get(userId);

  if (!scanInfo) {
    return Response.json({ error: 'No active scan found' }, { status: 404 });
  }

  // Kill the process
  process.kill(scanInfo.pid);
  activeScans.delete(userId);

  return Response.json({ success: true });
}
```

**Update `app/api/scanner/logs/route.ts`:**
- Filter logs by user ID
- Only show logs for the current user's scan
- Admins can optionally see all scans

### Frontend Updates

**Refactor `app/scanner/page.tsx`:**

1. **Add Session Check**
   ```tsx
   import { auth } from '@/auth';
   import { redirect } from 'next/navigation';

   export default async function ScannerPage() {
     const session = await auth();
     if (!session) redirect('/login');

     const userId = parseInt(session.user.id);
     const isAdmin = session.user.role === 'ADMIN';
     // ...
   }
   ```

2. **Update Scanner Status Display**
   - Show user's personal settings being used
   - Display active countries for this user
   - Show "1 scan limit" message
   - If scan active, show stop button
   - If no scan, show start button with settings preview

3. **Admin Overview** (optional)
   - Separate section showing all active scans
   - Read-only view of other users' scans
   - Ability to see which users are scanning

## Phase 6.5 – UI Feature Restoration (User-Specific Data Integration)

**Purpose:** Restore all features that were temporarily disabled during Phase 1-2 migration. Now that all backend infrastructure is in place (auth, settings, scanner), we can integrate user-specific data into the UI.

### What Was Disabled

During Phase 1-2, we removed these columns from shared tables:
- `Concert.interested` → `UserConcert.interested`
- `Concert.notes` → `UserConcert.notes`
- `Artist.playcount` → `UserArtist.playcount`
- `Artist.playcount12months` → `UserArtist.playcount12months`
- `Artist.recent` → `UserArtist.recent`

This broke several UI features that need to be restored with user-specific queries.

---

### 1. Home Page (`app/page.tsx`)

**Current State:**
```ts
const concerts = await prisma.concert.findMany({
  orderBy: [{ dateStart: 'asc' }],
  include: { artist: true, countryObj: true }
});
```

**Restore To:**
```ts
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  const userId = session ? parseInt(session.user.id) : null;

  const concerts = await prisma.concert.findMany({
    orderBy: [{ dateStart: 'asc' }],
    include: {
      artist: true,
      countryObj: true,
      userConcerts: userId ? {
        where: { userId },
        select: { interested: true, notes: true }
      } : false
    }
  });

  // Transform to add interested flag at top level for sorting
  const concertsWithUserData = concerts.map(c => ({
    ...c,
    interested: c.userConcerts?.[0]?.interested ?? false,
    notes: c.userConcerts?.[0]?.notes ?? null
  }));

  // Sort: interested first, then by date
  concertsWithUserData.sort((a, b) => {
    if (a.interested !== b.interested) return b.interested ? 1 : -1;
    return a.dateStart - b.dateStart;
  });

  return <ConcertGrid concerts={concertsWithUserData} />;
}
```

---

### 2. Concert Detail Page (`app/concerts/[id]/page.tsx`)

**Update API Route** (`app/api/concerts/[id]/route.ts`):
```ts
import { auth } from '@/auth';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session ? parseInt(session.user.id) : null;
  const concertId = parseInt(params.id);

  const concert = await prisma.concert.findUnique({
    where: { id: concertId },
    include: {
      artist: true,
      countryObj: true,
      userConcerts: userId ? {
        where: { userId },
        select: { interested: true, notes: true }
      } : false
    }
  });

  if (!concert) return new Response('Not found', { status: 404 });

  return Response.json({
    ...concert,
    interested: concert.userConcerts?.[0]?.interested ?? false,
    notes: concert.userConcerts?.[0]?.notes ?? null
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userId = parseInt(session.user.id);
  const concertId = parseInt(params.id);
  const { interested, notes } = await req.json();

  // Upsert UserConcert record
  const userConcert = await prisma.userConcert.upsert({
    where: {
      userId_concertId: { userId, concertId }
    },
    create: {
      userId,
      concertId,
      interested: interested ?? false,
      notes: notes ?? null
    },
    update: {
      interested: interested ?? undefined,
      notes: notes ?? undefined
    }
  });

  return Response.json(userConcert);
}
```

---

### 3. Artists Page (`app/artists/page.tsx`)

**Update to show user-specific playcount:**
```ts
import { auth } from '@/auth';

export default async function ArtistsPage() {
  const session = await auth();
  const userId = session ? parseInt(session.user.id) : null;

  const artists = await prisma.artist.findMany({
    include: {
      userArtists: userId ? {
        where: { userId },
        select: { playcount: true, playcount12month: true, recent: true }
      } : false,
      concerts: {
        where: { dateStart: { gte: Math.floor(Date.now() / 1000) } },
        select: { id: true, country: true }
      }
    }
  });

  // Transform to add playcount at top level
  const artistsWithUserData = artists.map(a => ({
    ...a,
    playcount: a.userArtists?.[0]?.playcount ?? 0,
    playcount12month: a.userArtists?.[0]?.playcount12month ?? 0,
    recent: a.userArtists?.[0]?.recent ?? false,
    upcomingConcerts: a.concerts.length
  }));

  // Filter: only show artists with upcoming concerts
  const filtered = artistsWithUserData.filter(a => a.upcomingConcerts > 0);

  return <ArtistGrid artists={filtered} />;
}
```

---

### 4. Artist Detail Page (`app/artists/[id]/page.tsx`)

**Update to show user-specific data:**
```ts
import { auth } from '@/auth';

export default async function ArtistDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session ? parseInt(session.user.id) : null;
  const artistId = parseInt(params.id);

  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    include: {
      userArtists: userId ? {
        where: { userId },
        select: { playcount: true, playcount12month: true, recent: true }
      } : false,
      concerts: {
        include: {
          countryObj: true,
          userConcerts: userId ? {
            where: { userId },
            select: { interested: true, notes: true }
          } : false
        }
      }
    }
  });

  if (!artist) return notFound();

  const artistWithUserData = {
    ...artist,
    playcount: artist.userArtists?.[0]?.playcount ?? 0,
    playcount12month: artist.userArtists?.[0]?.playcount12month ?? 0,
    recent: artist.userArtists?.[0]?.recent ?? false,
    concerts: artist.concerts.map(c => ({
      ...c,
      interested: c.userConcerts?.[0]?.interested ?? false,
      notes: c.userConcerts?.[0]?.notes ?? null
    }))
  };

  return <ArtistDetail artist={artistWithUserData} />;
}
```

---

### 5. Calendar View (`app/calendar/page.tsx`)

**Update to include user-specific interested flags:**
```ts
import { auth } from '@/auth';

export default async function CalendarPage() {
  const session = await auth();
  const userId = session ? parseInt(session.user.id) : null;

  const concerts = await prisma.concert.findMany({
    include: {
      artist: true,
      countryObj: true,
      userConcerts: userId ? {
        where: { userId },
        select: { interested: true }
      } : false
    }
  });

  const concertsWithUserData = concerts.map(c => ({
    ...c,
    interested: c.userConcerts?.[0]?.interested ?? false
  }));

  return <CalendarView concerts={concertsWithUserData} />;
}
```

---

### 6. Client Components Updates

**Update `ConcertGrid.tsx`, `ConcertCard.tsx`, etc.:**
- Accept `interested` and `notes` as props (now from `userConcerts` join)
- Update API calls to use new PATCH endpoint
- Ensure "Mark Interested" button works with user-specific data

**Update `ArtistCard.tsx`:**
- Accept `playcount`, `playcount12month`, `recent` as props
- Display user-specific metrics
- Show "Recent" badge if `recent === true`

---

### Testing Checklist

After implementing Phase 6.5:
- [ ] Home page shows interested concerts first (user-specific)
- [ ] Concert detail page can mark interested and add notes
- [ ] Artist pages show correct playcount for logged-in user
- [ ] Multiple users see different interested flags for same concert
- [ ] Multiple users see different playcounts for same artist
- [ ] Unauthenticated users see default values (0 playcount, not interested)
- [ ] Calendar view respects user-specific interested flags
- [ ] All filters and sorting work with user-specific data

---

## Phase 7 – Security, Testing, and Monitoring

### Security Checklist
- Enable HTTPS for production; ensure `NEXTAUTH_SECRET` configured correctly.
- Implement brute-force protection (rate limiting or CAPTCHA after threshold).
- Sanitize/escape user inputs to settings APIs; validate keys and value types.
- Secure audit log access to admins only.

### Testing Strategy
- **Unit Tests**
  - Prisma: ensure `@@unique` constraints, cascade deletes, default values.
  - NextAuth: test authorize callback with valid/invalid credentials.
- **Integration Tests**
  - API routes for global/per-user settings, countries, concerts.
  - Scanner API with mocked parser process.
- **End-to-End Tests**
  - Playwright/Cypress scenarios: admin creates user → user logs in → updates settings → runs scanner.

### Monitoring & Logging
- Integrate audit logs with existing logging pipeline (e.g., send to console + persisted DB).
- Optionally expose Prometheus metrics for active scans, login failures, audit events.

## Phase 8 – Rollout Plan
1. Run database migrations (Prisma + SQLAlchemy scripts) in staging; verify schema changes and populate initial admin.
2. Deploy NextAuth-enabled backend & updated frontend simultaneously to avoid schema mismatch.
3. Update Python parser deployment to latest SQLAlchemy models.
4. Post-deploy validation checklist:
   - Admin login works; audit log entries appear on global setting change.
   - User-specific interested/notes persist correctly.
   - Scanner uses per-user settings and runs concurrently without conflicts.

## Appendix A – Seed & Migration Scripts

### Seed Initial Admin (Prisma Script)
```ts
import { prisma } from '../src/lib/prisma';
import bcrypt from 'bcrypt';

async function main() {
  const password = await bcrypt.hash('ReplaceMe123!', 12);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      hashedPassword: password,
      role: 'ADMIN',
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      settings: {
        createMany: {
          data: [
            { key: 'MIN_PLAYCOUNT', value: '1', valueType: 'int', createdAt: now(), updatedAt: now() },
            { key: 'LASTFM_USER', value: '', valueType: 'string', createdAt: now(), updatedAt: now() },
            { key: 'LASTFM_API_KEY', value: '', valueType: 'string', createdAt: now(), updatedAt: now() }
          ]
        }
      }
    }
  });
}
```

### Prisma Migration Snippet (SQL)
```sql
ALTER TABLE Concert DROP COLUMN interested;
ALTER TABLE Concert DROP COLUMN notes;
```
Run only after application uses `UserConcert`.

## Appendix B – UI Wireframes (Textual)

### Login Page
- Centered card with username & password inputs, login button, "Forgot password" (admin manual flow).

### Settings Page (User View)
```
+-----------------------------------------------------+
| My Settings                                         |
|  - Last.fm Username  [______________]               |
|  - Last.fm API Key   [______________]               |
|  - Minimum Playcount [ 1 ]                          |
|                                                     |
| Active Countries                                   |
|  [Add Country ________________][Add]                |
|  [ ] Germany (deactivate)                          |
|  [x] Sweden (activate toggle)                      |
+-----------------------------------------------------+
```

### Settings Page (Admin View Adds)
```
+-----------------------------+  +-------------------+
| Global Settings             |  | Audit Log         |
|  FANART_API_KEY [********]  |  | Time | User | Key |
|  WEBSHARE_PROXY_URL [...]   |  | ---- | ---- | --- |
|  [Save]  [Cancel]           |  | ...                |
+-----------------------------+  +-------------------+
```

### Admin User Management
```
Users:
-------------------------------------------------
| Username | Role  | Created        | Actions   |
| admin    | ADMIN | 2025-11-01     | [Reset]   |
| alice    | USER  | 2025-11-05     | [Promote] |
-------------------------------------------------
[Create User]
```

---
Use this document as the working blueprint for implementing user profiles, authentication, and role-aware settings in the project. Ensure each phase is completed and verified before progressing to the next.
