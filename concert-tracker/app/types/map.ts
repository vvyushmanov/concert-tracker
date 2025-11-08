export interface MapConcert {
  id: number;
  eventName: string;
  eventUrl: string;
  dateStart: number;
  dateEnd: number;
  venue: string;
  city: string;  // Computed from cityMapping.originalCity
  normalizedCity: string;  // Computed from cityMapping.cityNormalized.normalizedCity
  cityMapping?: {
    originalCity: string;
    cityNormalized?: {
      normalizedCity: string;
    };
  };
  country: {
    id: number;
    name: string;
    code: string;
  };
  artists: {
    id: number;
    artistId: number;
    isPrimary: boolean;
    artist: {
      id: number;
      name: string;
      imageUrl: string | null;
    };
  }[];
  imageUrl: string | null;
  coordinates: {
    lat: number;
    lng: number;
  } | null;
  userInteractions: {
    userId: number;
    username: string;
    interested: boolean;
  }[];
}

export interface MapConcertsResponse {
  concerts: MapConcert[];
  meta: {
    total: number;
    dateRange: {
      startDate: number;
      endDate: number;
    };
    userCount: number;
  };
}

export interface MapFriend {
  id: number;
  username: string;
}

export interface MapFriendsResponse {
  friends: MapFriend[];
}

export interface MapFilters {
  startDate: number;
  endDate: number;
  friendIds: number[];
  artistIds: number[];
  countryIds: number[];
  interestedOnly: boolean;
  sharedOnly: boolean;
}

export interface TimelinePreset {
  label: string;
  days: number;
}

export const TIMELINE_PRESETS: TimelinePreset[] = [
  { label: 'Next Week', days: 7 },
  { label: 'Next 2 Weeks', days: 14 },
  { label: 'Next Month', days: 30 },
  { label: 'Next 2 Months', days: 60 },
  { label: 'Next 3 Months', days: 90 },
  { label: 'Next Year', days: 365 }
];

export const MAX_SELECTED_FRIENDS = 5;
export const MAX_TIMEFRAME_DAYS = 365;
