/**
 * Color palette for friend concert markers
 * Each friend gets a unique color from this palette
 */
export const FRIEND_COLORS = [
  '#3B82F6', // Blue (current user)
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#F59E0B', // Amber
  '#10B981', // Green
  '#EF4444', // Red
];

/**
 * Get color for a user based on their position in the selected friends list
 * @param userId - The user ID
 * @param currentUserId - The current logged-in user ID
 * @param selectedFriendIds - Array of selected friend IDs
 * @returns Hex color string
 */
export function getUserColor(
  userId: number,
  currentUserId: number,
  selectedFriendIds: number[]
): string {
  // Current user always gets the first color (blue)
  if (userId === currentUserId) {
    return FRIEND_COLORS[0];
  }

  // Find the friend's index in the selected list
  const friendIndex = selectedFriendIds.indexOf(userId);
  if (friendIndex === -1) {
    // Friend not selected - return white/light gray
    return '#E5E7EB'; // gray-200
  }

  // Assign color based on position (offset by 1 since index 0 is for current user)
  return FRIEND_COLORS[(friendIndex + 1) % FRIEND_COLORS.length];
}

/**
 * Get a map of user IDs to their assigned colors
 * @param currentUserId - The current logged-in user ID
 * @param selectedFriendIds - Array of selected friend IDs
 * @returns Map of userId to color
 */
export function getUserColorMap(
  currentUserId: number,
  selectedFriendIds: number[]
): Map<number, string> {
  const colorMap = new Map<number, string>();
  
  // Add current user
  colorMap.set(currentUserId, FRIEND_COLORS[0]);
  
  // Add friends
  selectedFriendIds.forEach((friendId, index) => {
    colorMap.set(friendId, FRIEND_COLORS[(index + 1) % FRIEND_COLORS.length]);
  });
  
  return colorMap;
}

/**
 * Get the emoji for shared concerts (when multiple users are interested)
 */
export const SHARED_CONCERT_EMOJI = '🔥';

/**
 * Check if a concert is shared between multiple users
 * @param userInteractions - Array of user interactions for a concert
 * @returns True if more than one user is interested
 */
export function isConcertShared(userInteractions: { userId: number }[]): boolean {
  return userInteractions.length > 1;
}
