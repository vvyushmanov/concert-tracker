# Friends Feature Testing Checklist

## Automated Tests
Run: `npm run test:friends` or `npx tsx scripts/test-friends-feature.ts`

- [ ] Friend request send/accept/decline/cancel
- [ ] Auto-accept logic
- [ ] Unfriend functionality
- [ ] Friend limit (500)
- [ ] Notification cleanup (100 limit)
- [ ] Friend stats calculation
- [ ] Mark notifications as read
- [ ] Security & privacy checks
- [ ] Cascade delete
- [ ] Alphabetical sorting

---

## Manual UI Testing

### 1. Navigation & Bell Icon
- [ ] "Friends" link appears in navigation bar
- [ ] Bell icon appears in navigation bar
- [ ] Unread count badge shows on bell icon
- [ ] Badge updates when new notifications arrive
- [ ] Clicking bell opens notification panel
- [ ] Clicking outside panel closes it

### 2. Notification Panel (Dropdown)
- [ ] Shows last 20 notifications
- [ ] Unread notifications highlighted (blue background)
- [ ] "New" badge on unread notifications
- [ ] Correct icons for notification types (👋 friend request, ✅ accepted)
- [ ] Relative time display ("5m ago", "2h ago")
- [ ] "Mark all as read" button appears when unread exist
- [ ] Click notification marks as read
- [ ] Click notification navigates to /notifications
- [ ] Delete button (X) removes notification
- [ ] "View all notifications" link goes to /notifications

### 3. Notifications Page (/notifications)
- [ ] Page loads successfully
- [ ] Shows all notifications (up to 100)
- [ ] Filter buttons: "All" and "Unread"
- [ ] Count badges on filter buttons
- [ ] "Mark all as read" button (only when unread exist)
- [ ] Unread notifications highlighted
- [ ] Click notification navigates to Friends page
- [ ] Delete button removes notification
- [ ] Empty state shows when no notifications
- [ ] Responsive design works on mobile

### 4. Friends Page (/friends)
- [ ] Page loads successfully
- [ ] Three tabs: Friends, Incoming Requests, Sent Requests
- [ ] Tab counts display correctly
- [ ] "Add Friend" input and button at top

#### Friends List Tab
- [ ] Shows all accepted friends
- [ ] Friends sorted alphabetically
- [ ] Each friend shows:
  - [ ] Username
  - [ ] Total concerts count
  - [ ] Total artists count
  - [ ] Upcoming concerts count
- [ ] "Unfriend" button on each friend
- [ ] Clicking "Unfriend" shows confirmation
- [ ] Confirm/Cancel buttons work
- [ ] Empty state when no friends

#### Incoming Requests Tab
- [ ] Shows pending requests received
- [ ] Each request shows:
  - [ ] Sender username
  - [ ] Date sent
- [ ] "Accept" button (green)
- [ ] "Decline" button (red)
- [ ] Accepting creates notification for sender
- [ ] Declining removes request
- [ ] Empty state when no incoming requests

#### Sent Requests Tab
- [ ] Shows pending requests sent
- [ ] Each request shows:
  - [ ] Recipient username
  - [ ] Date sent
- [ ] "Cancel" button
- [ ] Cancelling removes request
- [ ] Empty state when no sent requests

### 5. Add Friend Functionality
- [ ] Input accepts username
- [ ] "Send Request" button works
- [ ] Success message on send
- [ ] Error message if user not found
- [ ] Error message if already friends
- [ ] Error message if request already sent
- [ ] Error message if trying to friend yourself
- [ ] Error message if friend limit reached (500)
- [ ] Auto-accept works (both users have pending requests)
- [ ] Auto-accept shows success message
- [ ] Auto-accept creates notifications for both users

### 6. Notification Polling
- [ ] Notifications poll every 30 seconds
- [ ] Unread count updates automatically
- [ ] No console errors during polling
- [ ] Polling stops when user logs out
- [ ] Polling resumes when user logs back in

### 7. Friend Stats
- [ ] Total concerts count is accurate
- [ ] Total artists count is accurate
- [ ] Upcoming concerts count is accurate
- [ ] Stats update after user adds concerts/artists

### 8. Security & Privacy
- [ ] Cannot see other users' notifications
- [ ] Cannot accept/decline requests not sent to you
- [ ] Cannot unfriend users you're not friends with
- [ ] Cannot send friend request to yourself
- [ ] Auth required for all friend/notification endpoints
- [ ] Unauthorized requests return 401

### 9. Edge Cases
- [ ] Sending request to non-existent user shows error
- [ ] Accepting already-accepted request shows error
- [ ] Declining already-declined request shows error
- [ ] Unfriending already-unfriended user shows error
- [ ] Notification cleanup keeps only last 100
- [ ] Friend limit enforced at 500
- [ ] Deleting user cascades to friendships
- [ ] Deleting user cascades to notifications

### 10. Performance
- [ ] Friends page loads quickly (<1s)
- [ ] Notifications page loads quickly (<1s)
- [ ] No lag when marking notifications as read
- [ ] No lag when accepting/declining requests
- [ ] Polling doesn't cause UI freezes

### 11. Responsive Design
- [ ] All pages work on mobile (320px width)
- [ ] All pages work on tablet (768px width)
- [ ] All pages work on desktop (1920px width)
- [ ] Navigation collapses properly on mobile
- [ ] Notification panel fits on mobile screen
- [ ] Friends page tabs work on mobile

### 12. Dark Mode
- [ ] All components support dark mode
- [ ] Colors are readable in dark mode
- [ ] Hover states work in dark mode
- [ ] Unread highlights visible in dark mode

---

## API Endpoint Testing (Postman/curl)

### Friends Endpoints

#### GET /api/friends
```bash
curl -X GET http://localhost:3000/api/friends \
  -H "Cookie: authjs.session-token=YOUR_SESSION"
```
- [ ] Returns list of accepted friends
- [ ] Includes friend stats
- [ ] Sorted alphabetically
- [ ] Returns 401 without auth

#### POST /api/friends
```bash
curl -X POST http://localhost:3000/api/friends \
  -H "Cookie: authjs.session-token=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"username":"targetuser"}'
```
- [ ] Creates friend request
- [ ] Creates notification
- [ ] Auto-accepts if mutual pending
- [ ] Returns error if user not found
- [ ] Returns error if already friends
- [ ] Returns error if limit reached (500)
- [ ] Returns 401 without auth

#### GET /api/friends/requests
```bash
curl -X GET http://localhost:3000/api/friends/requests \
  -H "Cookie: authjs.session-token=YOUR_SESSION"
```
- [ ] Returns incoming requests
- [ ] Returns outgoing requests
- [ ] Sorted by date (newest first)
- [ ] Returns 401 without auth

#### PATCH /api/friends/[id]
```bash
curl -X PATCH http://localhost:3000/api/friends/1 \
  -H "Cookie: authjs.session-token=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"action":"accept"}'
```
- [ ] Accepts friend request
- [ ] Creates notification
- [ ] Returns error if not recipient
- [ ] Returns error if already processed
- [ ] Returns 401 without auth

```bash
curl -X PATCH http://localhost:3000/api/friends/1 \
  -H "Cookie: authjs.session-token=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"action":"decline"}'
```
- [ ] Declines friend request
- [ ] Deletes friendship
- [ ] Returns 401 without auth

#### DELETE /api/friends/[id]
```bash
curl -X DELETE http://localhost:3000/api/friends/1 \
  -H "Cookie: authjs.session-token=YOUR_SESSION"
```
- [ ] Unfriends or cancels request
- [ ] Works with friendship ID
- [ ] Works with friend user ID
- [ ] Returns error if not part of friendship
- [ ] Returns 401 without auth

### Notification Endpoints

#### GET /api/notifications
```bash
curl -X GET http://localhost:3000/api/notifications \
  -H "Cookie: authjs.session-token=YOUR_SESSION"
```
- [ ] Returns notifications list
- [ ] Returns unread count
- [ ] Includes fromUser data
- [ ] Sorted by date (newest first)
- [ ] Returns 401 without auth

#### PATCH /api/notifications
```bash
# Mark specific notifications as read
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Cookie: authjs.session-token=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"notificationIds":[1,2,3]}'
```
- [ ] Marks specific notifications as read
- [ ] Only marks user's own notifications
- [ ] Returns 401 without auth

```bash
# Mark all as read
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Cookie: authjs.session-token=YOUR_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"markAllRead":true}'
```
- [ ] Marks all unread as read
- [ ] Only marks user's own notifications
- [ ] Returns 401 without auth

#### DELETE /api/notifications/[id]
```bash
curl -X DELETE http://localhost:3000/api/notifications/1 \
  -H "Cookie: authjs.session-token=YOUR_SESSION"
```
- [ ] Deletes notification
- [ ] Only deletes user's own notifications
- [ ] Returns 404 if not found
- [ ] Returns 401 without auth

---

## Database Testing

### Schema Verification
- [ ] Friendship table exists
- [ ] Notification table exists
- [ ] User relations added
- [ ] Indexes created (userId, friendId, status, createdAt)
- [ ] Unique constraint on [userId, friendId]
- [ ] Cascade delete configured

### Data Integrity
- [ ] Cannot create duplicate friendships
- [ ] Cannot create friendship with self
- [ ] Deleting user deletes friendships
- [ ] Deleting user deletes notifications
- [ ] Notification cleanup keeps last 100

---

## Browser Console Testing

### Check for Errors
- [ ] No console errors on page load
- [ ] No console errors during polling
- [ ] No console errors when sending requests
- [ ] No console errors when accepting/declining
- [ ] No console errors when unfriending

### Network Tab
- [ ] Polling requests every 30 seconds
- [ ] API requests return correct status codes
- [ ] No unnecessary duplicate requests
- [ ] Request payloads are correct

---

## Test Results

**Date**: _____________  
**Tester**: _____________  
**Environment**: _____________  

**Overall Status**: ⬜ Pass ⬜ Fail  

**Notes**:
