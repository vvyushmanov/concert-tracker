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

## Phase 1 – Data Layer Foundations

### Prisma Schema Changes
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

### Migration Strategy
1. **Prisma Migration Script**
   - Add new tables and relations.
   - Backfill: for existing concerts with `interested/notes`, insert into `UserConcert` linked to an existing admin (or new legacy user).
   - Copy `Country.active` rows into `UserActiveCountry` for designated legacy user if needed; keep inactive for others.
   - Create initial admin account (manual seeded insert) with hashed password placeholder.
2. **SQLite Compatibility**
   - Write equivalent SQL migration for SQLite (pay attention to lack of `ON UPDATE CURRENT_TIMESTAMP`).
3. **Post-migration Cleanup**
   - Once UI/API reads user-specific data, drop `Concert.interested`, `Concert.notes`, and `Country.active` columns in a follow-up migration.

### Data Backfill Pseudocode
```sql
-- Example backfill to UserConcert
INSERT INTO UserConcert (userId, concertId, interested, notes, createdAt, updatedAt)
SELECT {legacy_user_id}, id, interested, notes, createdAt, updatedAt
FROM Concert
WHERE interested = true OR notes IS NOT NULL;
```
Perform equivalent operations for SQLite using `INSERT INTO ... SELECT` without `RETURNING`.

## Phase 2 – Authentication & Role Enforcement

### NextAuth Configuration
1. **Dependencies**
   ```bash
   pnpm add next-auth @auth/prisma-adapter bcrypt
   pnpm add -D @types/bcrypt
   ```
2. **Environment Variables**
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
3. **Prisma Adapter Setup** (`lib/auth.ts`)
   ```ts
   import NextAuth from 'next-auth';
   import Credentials from 'next-auth/providers/credentials';
   import { PrismaAdapter } from '@auth/prisma-adapter';
   import bcrypt from 'bcrypt';
   import { prisma } from '@/lib/prisma';

   export const authOptions = {
     adapter: PrismaAdapter(prisma),
     session: { strategy: 'jwt' },
     providers: [
       Credentials({
         name: 'Credentials',
         credentials: {
           username: { type: 'text' },
           password: { type: 'password' }
         },
         async authorize(credentials) {
           if (!credentials?.username || !credentials?.password) return null;
           const user = await prisma.user.findUnique({ where: { username: credentials.username } });
           if (!user) return null;
           const valid = await bcrypt.compare(credentials.password, user.hashedPassword);
           return valid ? { id: `${user.id}`, role: user.role } : null;
         }
       })
     ],
     callbacks: {
       async jwt({ token, user }) {
         if (user) {
           token.id = user.id;
           token.role = (user as any).role;
         }
         return token;
       },
       async session({ session, token }) {
         session.user = { id: token.id, role: token.role } as any;
         return session;
       }
     }
   } satisfies NextAuth.Config;
   ```
4. **Route Handlers**
   - `/app/api/auth/[...nextauth]/route.ts` exports `NextAuth(authOptions)`.
   - Protect sensitive APIs by checking `getServerSession` and `session.user.role`.

### Password Handling
- Store hashed passwords using `bcrypt.hash(password, 12)` when admins create/reset user credentials.
- Enforce minimal client-side validation: length ≥ 8, mix of characters.
- Rate-limit login requests (middleware or edge function) to reduce brute-force risk.

### Session Middleware
- Add `middleware.ts` to redirect unauthenticated users to login for protected routes (`/settings`, `/scanner`, `/admin`).
- Admin-only guard: check role before granting access to global settings & audit pages.

## Phase 3 – Settings Refactor & Audit Logging

### API Changes
1. **Global Settings** (`/api/settings/global`)
   - Methods: GET (all global settings), PUT/PATCH (admin only).
   - On every mutation, insert `SettingAuditLog` with `{ userId, key, oldValue, newValue, createdAt }`.
   - Optionally accept batch updates while logging each key separately.
2. **Per-User Settings** (`/api/settings/user`)
   - Methods: GET (current user’s settings merged with defaults), PUT (upsert keys).
3. **Countries**
   - `/api/settings/countries/user`: manage `UserActiveCountry` records.
   - `/api/settings/countries/admin`: allow admins to delete or rename countries if needed.
4. **Audit Log Endpoint**
   - `/api/settings/audit` (admin only): supports filters by key, user, date range, pagination.

### Frontend Adjustments
- **Settings Page Structure**
  - Tabs or sections: "My Settings" (per-user), "Global Settings" (visible & editable only to admins), "Audit Log" (admin).
  - Show global values read-only for users, with a banner explaining admin-only control.
- **Default Values**
  - When user has no override, UI displays fallback (e.g., `MIN_PLAYCOUNT` defaults to 1 but stored as override once user edits).
- **Countries UI**
  - Per-user: toggle active/inactive (checkbox). "Add Country" available to all.
  - Removal: "Deactivate" for users (removes row); "Delete" action reserved for admins to delete from entire DB.
- **Audit Log Table**
  - Columns: Timestamp, User, Key, Old Value, New Value.
  - Provide date/user filters and pagination.

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
- Parser continues populating shared `Concert` and `Artist` tables.
- Introduce CLI args/env to run parser for specific user:
  - Pass `--user-id` to load `UserSetting` and `UserActiveCountry`.
  - Ensure parser writes to `UserArtist` for personalized metrics.

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

### Backend
- Extend `/api/scanner/start` to require authentication, then:
  1. Fetch per-user settings and active countries.
  2. If the user already has an active scan, return a conflict error (or provide resume link).
  3. Otherwise spawn parser process with env vars: `LASTFM_USER`, `LASTFM_API_KEY`, `MIN_PLAYCOUNT`, plus `USER_ID` for per-user logging.
  4. Track process ID tied to user in server memory or DB to enforce single active scan per user while allowing concurrent scans across users.

### Frontend
- Show scanner card per user with status list:
  - Running scans (PID, start time, last log line).
  - Actions: Stop (only own process), view logs, retry once no scans active.
- Admins optionally see overview of all active scans (read-only) to monitor per-user limits.

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
