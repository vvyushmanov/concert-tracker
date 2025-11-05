# Friends Feature Implementation Plan

## Overview
Add friendship system allowing users to connect, send/accept friend requests, and view friend statistics. Foundation for future friend-related features.

## Requirements Summary

### Core Features
- **Unidirectional friend requests**: User A sends request, User B accepts/declines
- **Auto-accept**: If both users have pending requests to each other, auto-accept both
- **Cancel requests**: Users can cancel their own pending requests
- **Instant unfriend**: No confirmation needed from other party
- **Friend limit**: Maximum 500 friends per user
- **Notifications**: Bell icon in navbar with unread count, polling every 30 seconds
- **No expiration**: Friend requests never expire
- **Privacy**: All user data accessible to friends except settings (always private)

### Friend Stats Display
Each friend shows:
- Total concerts tracked
- Total artists tracked
- Upcoming concerts count

### Notification System
- **Types**: Friend request received, Friend request accepted
- **Retention**: Last 100 notifications per user
- **Polling interval**: 30 seconds
- **Mark as read**: Individual or bulk

### UI/UX
- **Navigation**: New "Friends" top-level item
- **Notification bell**: Icon with unread count badge
- **Friends page**: Tabs for Friends List, Incoming Requests, Sent Requests
- **Sorting**: Alphabetical by username

---

## Phase 1: Database Schema & Migration

### 1.1 Update Prisma Schema

**File**: `concert-tracker/prisma/schema.prisma`

Add two new models:

```prisma
model Friendship {
  id          Int      @id @default(autoincrement())
  userId      Int      // User who sent the request
  friendId    Int      // User who received the request
  status      String   @db.VarChar(20) // 'PENDING', 'ACCEPTED', 'DECLINED'
  createdAt   Int      // Unix timestamp
  updatedAt   Int      // Unix timestamp
  
  user        User     @relation("UserFriendships", fields: [userId], references: [id], onDelete: Cascade)
  friend      User     @relation("FriendFriendships", fields: [friendId], references: [id], onDelete: Cascade)
  
  @@unique([userId, friendId])
  @@index([userId])
  @@index([friendId])
  @@index([status])
}

model Notification {
  id          Int      @id @default(autoincrement())
  userId      Int      // Recipient of the notification
  type        String   @db.VarChar(50) // 'FRIEND_REQUEST', 'FRIEND_ACCEPTED'
  fromUserId  Int?     // User who triggered the notification
  message     String   @db.Text
  read        Boolean  @default(false)
  createdAt   Int      // Unix timestamp
  
  user        User     @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)
  fromUser    User?    @relation("NotificationsFrom", fields: [fromUserId], references: [id], onDelete: Cascade)
  
  @@index([userId, read])
  @@index([createdAt])
}
```

Update User model:

```prisma
model User {
  id                  Int              @id @default(autoincrement())
  username            String           @unique @db.VarChar(100)
  password            String           @db.VarChar(255)
  role                String           @db.VarChar(20)
  createdAt           Int
  updatedAt           Int
  
  // Existing relations
  settings            UserSetting[]
  artists             UserArtist[]
  concerts            UserConcert[]
  activeCountries     UserActiveCountry[]
  auditLogs           SettingAuditLog[]
  
  // NEW: Friend relations
  friendships         Friendship[]    @relation("UserFriendships")
  friendOf            Friendship[]    @relation("FriendFriendships")
  notifications       Notification[]  @relation("UserNotifications")
  notificationsSent   Notification[]  @relation("NotificationsFrom")
}
```

### 1.2 Update MySQL Schema

**File**: `concert-tracker/prisma/schema.mysql.prisma`

Apply same changes as above (MySQL-specific).

### 1.3 Update SQLite Schema

**File**: `concert-tracker/prisma/schema.sqlite.prisma`

Apply same changes (remove `@db.VarChar()` and `@db.Text` decorators for SQLite).

### 1.4 Generate Migration

```bash
cd concert-tracker
npx prisma migrate dev --name add_friends_and_notifications
npx prisma generate
```

---

## Phase 2: API Routes - Friends Management

### 2.1 Friends List & Send Request

**File**: `concert-tracker/app/api/friends/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// GET /api/friends - List all accepted friends with stats
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Get friendships where status is ACCEPTED
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userId, status: 'ACCEPTED' },
        { friendId: userId, status: 'ACCEPTED' }
      ]
    },
    include: {
      user: { select: { id: true, username: true } },
      friend: { select: { id: true, username: true } }
    }
  });
  
  // Extract friend user objects
  const friendUsers = friendships.map(f => 
    f.userId === userId ? f.friend : f.user
  );
  
  // Get stats for each friend
  const friendsWithStats = await Promise.all(
    friendUsers.map(async (friend) => {
      const [totalConcerts, totalArtists, upcomingConcerts] = await Promise.all([
        prisma.userConcert.count({ where: { userId: friend.id } }),
        prisma.userArtist.count({ where: { userId: friend.id } }),
        prisma.userConcert.count({
          where: {
            userId: friend.id,
            concert: { dateStart: { gte: Math.floor(Date.now() / 1000) } }
          }
        })
      ]);
      
      return {
        id: friend.id,
        username: friend.username,
        stats: {
          totalConcerts,
          totalArtists,
          upcomingConcerts
        }
      };
    })
  );
  
  // Sort alphabetically by username
  friendsWithStats.sort((a, b) => a.username.localeCompare(b.username));
  
  return NextResponse.json({ friends: friendsWithStats });
}

// POST /api/friends - Send friend request by username
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const { username } = await request.json();
  
  if (!username) {
    return NextResponse.json({ error: 'Username required' }, { status: 400 });
  }
  
  // Find target user
  const targetUser = await prisma.user.findUnique({
    where: { username }
  });
  
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  
  if (targetUser.id === userId) {
    return NextResponse.json({ error: 'Cannot friend yourself' }, { status: 400 });
  }
  
  // Check friend limit (500)
  const friendCount = await prisma.friendship.count({
    where: {
      OR: [
        { userId, status: 'ACCEPTED' },
        { friendId: userId, status: 'ACCEPTED' }
      ]
    }
  });
  
  if (friendCount >= 500) {
    return NextResponse.json({ error: 'Friend limit reached (500)' }, { status: 400 });
  }
  
  // Check if friendship already exists
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { userId, friendId: targetUser.id },
        { userId: targetUser.id, friendId: userId }
      ]
    }
  });
  
  if (existing) {
    if (existing.status === 'ACCEPTED') {
      return NextResponse.json({ error: 'Already friends' }, { status: 400 });
    }
    if (existing.status === 'PENDING') {
      // Auto-accept if both users have pending requests
      if (existing.userId === targetUser.id && existing.friendId === userId) {
        // Target user already sent request to current user - auto-accept both
        await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'ACCEPTED', updatedAt: Math.floor(Date.now() / 1000) }
        });
        
        // Create notification for both users
        const now = Math.floor(Date.now() / 1000);
        await prisma.notification.createMany({
          data: [
            {
              userId,
              type: 'FRIEND_ACCEPTED',
              fromUserId: targetUser.id,
              message: `${targetUser.username} accepted your friend request`,
              createdAt: now
            },
            {
              userId: targetUser.id,
              type: 'FRIEND_ACCEPTED',
              fromUserId: userId,
              message: `${session.user.username} accepted your friend request`,
              createdAt: now
            }
          ]
        });
        
        // Clean up old notifications (keep last 100 per user)
        await cleanupNotifications(userId);
        await cleanupNotifications(targetUser.id);
        
        return NextResponse.json({ 
          message: 'Friend request auto-accepted',
          autoAccepted: true 
        });
      }
      return NextResponse.json({ error: 'Friend request already sent' }, { status: 400 });
    }
  }
  
  // Create new friend request
  const now = Math.floor(Date.now() / 1000);
  await prisma.friendship.create({
    data: {
      userId,
      friendId: targetUser.id,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now
    }
  });
  
  // Create notification for target user
  await prisma.notification.create({
    data: {
      userId: targetUser.id,
      type: 'FRIEND_REQUEST',
      fromUserId: userId,
      message: `${session.user.username} sent you a friend request`,
      createdAt: now
    }
  });
  
  // Clean up old notifications
  await cleanupNotifications(targetUser.id);
  
  return NextResponse.json({ message: 'Friend request sent' });
}

// Helper: Keep only last 100 notifications per user
async function cleanupNotifications(userId: number) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  
  if (notifications.length > 100) {
    const toDelete = notifications.slice(100).map(n => n.id);
    await prisma.notification.deleteMany({
      where: { id: { in: toDelete } }
    });
  }
}
```

### 2.2 Friend Requests List

**File**: `concert-tracker/app/api/friends/requests/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// GET /api/friends/requests - List pending incoming/outgoing requests
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Incoming requests (where current user is friendId)
  const incoming = await prisma.friendship.findMany({
    where: {
      friendId: userId,
      status: 'PENDING'
    },
    include: {
      user: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  // Outgoing requests (where current user is userId)
  const outgoing = await prisma.friendship.findMany({
    where: {
      userId,
      status: 'PENDING'
    },
    include: {
      friend: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  return NextResponse.json({
    incoming: incoming.map(r => ({
      id: r.id,
      from: r.user,
      createdAt: r.createdAt
    })),
    outgoing: outgoing.map(r => ({
      id: r.id,
      to: r.friend,
      createdAt: r.createdAt
    }))
  });
}
```

### 2.3 Accept/Decline/Unfriend/Cancel

**File**: `concert-tracker/app/api/friends/[id]/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// PATCH /api/friends/[id] - Accept or decline friend request
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const friendshipId = parseInt(params.id);
  const { action } = await request.json(); // 'accept' or 'decline'
  
  if (!['accept', 'decline'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  
  // Find friendship
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId },
    include: {
      user: { select: { username: true } },
      friend: { select: { username: true } }
    }
  });
  
  if (!friendship) {
    return NextResponse.json({ error: 'Friend request not found' }, { status: 404 });
  }
  
  // Only the recipient (friendId) can accept/decline
  if (friendship.friendId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  if (friendship.status !== 'PENDING') {
    return NextResponse.json({ error: 'Request already processed' }, { status: 400 });
  }
  
  const now = Math.floor(Date.now() / 1000);
  
  if (action === 'accept') {
    // Accept friend request
    await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'ACCEPTED', updatedAt: now }
    });
    
    // Create notification for requester
    await prisma.notification.create({
      data: {
        userId: friendship.userId,
        type: 'FRIEND_ACCEPTED',
        fromUserId: userId,
        message: `${session.user.username} accepted your friend request`,
        createdAt: now
      }
    });
    
    // Clean up old notifications
    await cleanupNotifications(friendship.userId);
    
    return NextResponse.json({ message: 'Friend request accepted' });
  } else {
    // Decline friend request (just delete it)
    await prisma.friendship.delete({
      where: { id: friendshipId }
    });
    
    return NextResponse.json({ message: 'Friend request declined' });
  }
}

// DELETE /api/friends/[id] - Unfriend or cancel request
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const friendshipId = parseInt(params.id);
  
  // Find friendship
  const friendship = await prisma.friendship.findUnique({
    where: { id: friendshipId }
  });
  
  if (!friendship) {
    return NextResponse.json({ error: 'Friendship not found' }, { status: 404 });
  }
  
  // User must be part of the friendship
  if (friendship.userId !== userId && friendship.friendId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  // Delete friendship (instant unfriend or cancel request)
  await prisma.friendship.delete({
    where: { id: friendshipId }
  });
  
  const message = friendship.status === 'PENDING' 
    ? 'Friend request cancelled' 
    : 'Friend removed';
  
  return NextResponse.json({ message });
}

// Helper: Keep only last 100 notifications per user
async function cleanupNotifications(userId: number) {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  
  if (notifications.length > 100) {
    const toDelete = notifications.slice(100).map(n => n.id);
    await prisma.notification.deleteMany({
      where: { id: { in: toDelete } }
    });
  }
}
```

---

## Phase 3: API Routes - Notifications

### 3.1 Notifications List & Mark Read

**File**: `concert-tracker/app/api/notifications/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// GET /api/notifications - List user's notifications
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  
  // Get unread count
  const unreadCount = await prisma.notification.count({
    where: { userId, read: false }
  });
  
  // Get recent notifications (last 20)
  const notifications = await prisma.notification.findMany({
    where: { userId },
    include: {
      fromUser: { select: { id: true, username: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  
  return NextResponse.json({
    unreadCount,
    notifications: notifications.map(n => ({
      id: n.id,
      type: n.type,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt,
      fromUser: n.fromUser
    }))
  });
}

// PATCH /api/notifications - Mark notification(s) as read
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const { notificationIds, markAllRead } = await request.json();
  
  if (markAllRead) {
    // Mark all as read
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });
    return NextResponse.json({ message: 'All notifications marked as read' });
  }
  
  if (!notificationIds || !Array.isArray(notificationIds)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  
  // Mark specific notifications as read
  await prisma.notification.updateMany({
    where: {
      id: { in: notificationIds },
      userId // Security: only mark user's own notifications
    },
    data: { read: true }
  });
  
  return NextResponse.json({ message: 'Notifications marked as read' });
}
```

### 3.2 Delete Notification

**File**: `concert-tracker/app/api/notifications/[id]/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

// DELETE /api/notifications/[id] - Delete specific notification
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const userId = parseInt(session.user.id);
  const notificationId = parseInt(params.id);
  
  // Find notification
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });
  
  if (!notification) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }
  
  // Security: only delete own notifications
  if (notification.userId !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  
  await prisma.notification.delete({
    where: { id: notificationId }
  });
  
  return NextResponse.json({ message: 'Notification deleted' });
}
```

---

## Phase 4: UI Components - Navigation

### 4.1 Update Navigation Component

**File**: `concert-tracker/app/components/Navigation.tsx`

Add notification bell icon with polling and unread count badge.

**Key changes:**
- Add "Friends" navigation link
- Add notification bell icon with badge
- Poll `/api/notifications` every 30 seconds
- Show notification panel on click

---

## Phase 5: UI Components - Friends Page

### 5.1 Server Component

**File**: `concert-tracker/app/friends/page.tsx`

```typescript
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import FriendsClient from './FriendsClient';

export default async function FriendsPage() {
  const session = await auth();
  
  if (!session?.user?.id) {
    redirect('/api/auth/signin');
  }
  
  return <FriendsClient />;
}
```

### 5.2 Client Component

**File**: `concert-tracker/app/friends/FriendsClient.tsx`

**Features:**
- Three tabs: Friends List, Incoming Requests, Sent Requests
- Add friend by username (search input + button)
- Friends list with stats (concerts, artists, upcoming)
- Accept/Decline buttons for incoming requests
- Cancel button for sent requests
- Unfriend button with confirmation modal
- Real-time updates after actions

---

## Phase 6: UI Components - Notification Panel

### 6.1 Notification Panel Component

**File**: `concert-tracker/app/components/NotificationPanel.tsx`

**Features:**
- Dropdown panel from bell icon
- List of recent notifications (last 20)
- Mark as read (individual or all)
- Delete notification
- Click notification to navigate to Friends page
- Auto-close on outside click

---

## Phase 7: Testing & Validation

### 7.1 Database Testing
- Verify migrations applied correctly
- Test foreign key constraints
- Verify cascading deletes

### 7.2 API Testing
- Test all endpoints with Postman/curl
- Verify auth checks
- Test edge cases (self-friend, duplicate requests, etc.)
- Test auto-accept logic
- Test friend limit (500)
- Test notification cleanup (100 limit)

### 7.3 UI Testing
- Test all user flows
- Verify real-time updates
- Test notification polling
- Test responsive design
- Test error handling

### 7.4 Security Testing
- Verify users can only access own data
- Test unauthorized access attempts
- Verify notification privacy
- Test SQL injection prevention

---

## Phase 8: Documentation & Deployment

### 8.1 Update Documentation
- Update README with Friends feature
- Document API endpoints
- Add usage examples

### 8.2 Deployment
- Run migrations in production
- Deploy updated code
- Monitor for errors
- Verify notification polling performance

---

## Technical Notes

### Auto-Accept Logic
When User A sends request to User B:
1. Check if User B already has pending request to User A
2. If yes: Update existing request to ACCEPTED, create notifications for both
3. If no: Create new PENDING request, notify User B

### Notification Cleanup
After creating any notification:
1. Query all notifications for target user, ordered by createdAt DESC
2. If count > 100, delete oldest notifications beyond 100

### Friend Stats Calculation
For each friend, count:
- `UserConcert` records (total concerts)
- `UserArtist` records (total artists)
- `UserConcert` records where `concert.dateStart >= now` (upcoming)

### Polling Strategy
- Poll `/api/notifications` every 30 seconds
- Only fetch unread count + last 20 notifications
- Use React state to manage notification panel visibility
- Mark as read when user clicks notification

### Database Indexes
- `Friendship`: userId, friendId, status (for fast lookups)
- `Notification`: userId + read (for unread count), createdAt (for ordering)

---

## Future Enhancements (Out of Scope)

- Real-time notifications via WebSocket/SSE
- Friend activity feed
- Friend comparison views
- Privacy settings per friend
- Block/unblock users
- Friend suggestions
- Search friends by criteria
- Export friend list
