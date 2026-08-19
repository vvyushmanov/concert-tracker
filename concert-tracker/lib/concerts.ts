import { prisma } from '@/lib/prisma';

/**
 * Read-time personalization core (Milestone 1).
 *
 * Concerts are stored GLOBALLY (the scraper/agent no longer materializes per-user
 * rows). "Relevant to a user" is computed here at read time:
 *   - the concert is in one of the user's active countries (UserActiveCountry), and
 *   - at least one linked artist is in the user's followed set (UserArtist).
 *
 * UserConcert is now pure user-state (interested / notes / isPrivate) and is
 * left-joined in — it does NOT gate visibility.
 *
 * Every read surface (home, calendar, countries, artists, map) goes through this
 * helper so the personalization rules live in exactly one place.
 */

export interface RelevantConcertsOptions {
  /** Filter to a single country by full name (e.g. "France"). */
  countryName?: string | null;
  /** Filter to a single original city string. */
  city?: string | null;
  /**
   * Explicit country id allow-list (e.g. the map's `countryIds` param).
   * When omitted/empty, the user's active countries are used. When the user has
   * no active countries either, no country restriction is applied.
   */
  countryIds?: number[];
  /**
   * Restrict to a subset of artists (e.g. the map's artist filter). Intersected
   * with the user's followed set — only followed artists are ever relevant.
   */
  artistIds?: number[];
  /** Only future concerts (dateStart >= now). Default true. Ignored if a date window is given. */
  upcomingOnly?: boolean;
  /** Explicit unix-seconds window (used by the map). Overrides `upcomingOnly`. */
  startDate?: number;
  endDate?: number;
}

export interface RelevantArtist {
  id: number;
  name: string;
  mbid: string | null;
  imageUrl: string | null;
  createdAt: number;
  updatedAt: number;
  /** Per-user listening stats merged from UserArtist (0 when not present). */
  playcount: number;
  playcount12month: number;
  recent: boolean;
  /** True when this artist is in the user's followed set. */
  followed: boolean;
}

export interface RelevantConcert {
  id: number;
  eventName: string;
  eventUrl: string;
  dateStart: number;
  dateEnd: number;
  venue: string;
  cityMappingId: number;
  countryId: number;
  postalCode: string | null;
  performers: string;
  imageUrl: string | null;
  organizer: string | null;
  organizerUrl: string | null;
  ticketLinks: string;
  createdAt: number;
  updatedAt: number;
  cityMapping: any;
  countryObj: any;
  /** Pure user-state from UserConcert (defaults when no row exists). */
  interested: boolean;
  notes: string | null;
  isPrivate: boolean;
  /** Primary-artist convenience fields (backward compat with existing pages). */
  artistId: number | undefined;
  artist: RelevantArtist | null;
  artists: Array<{
    id: number;
    artistId: number;
    concertId: number;
    isPrimary: boolean;
    artist: RelevantArtist;
  }>;
}

export interface RelevantConcertsResult {
  /**
   * Shaped concerts. Typed `any[]` to match the codebase's existing loosely-typed
   * concert objects (the client components consume `any`); the concrete runtime
   * shape is documented by `RelevantConcert` above.
   */
  concerts: any[];
  /** The user's followed artist ids (UserArtist), for callers that need the set. */
  followedArtistIds: number[];
}

/**
 * Fetch the concerts relevant to `userId`, fully shaped with the user's
 * interaction state and per-artist playcounts.
 */
export async function getRelevantConcerts(
  userId: number,
  opts: RelevantConcertsOptions = {}
): Promise<RelevantConcertsResult> {
  const now = Math.floor(Date.now() / 1000);
  const upcomingOnly = opts.upcomingOnly ?? true;

  // 1. Followed artists (UserArtist) + per-artist stats map.
  const userArtists = await prisma.userArtist.findMany({ where: { userId } });
  if (userArtists.length === 0) {
    // The user follows no artists yet → nothing is relevant.
    return { concerts: [], followedArtistIds: [] };
  }
  const followedArtistIds = userArtists.map((ua) => ua.artistId);
  const statsMap = new Map(userArtists.map((ua) => [ua.artistId, ua]));

  // Optionally restrict to a requested subset (intersected with followed).
  let queryArtistIds = followedArtistIds;
  if (opts.artistIds && opts.artistIds.length > 0) {
    const requested = new Set(opts.artistIds);
    queryArtistIds = followedArtistIds.filter((id) => requested.has(id));
    if (queryArtistIds.length === 0) {
      return { concerts: [], followedArtistIds };
    }
  }

  // 2. Country scope: explicit ids > user's active countries > unrestricted.
  let countryIds = opts.countryIds && opts.countryIds.length > 0 ? opts.countryIds : [];
  if (countryIds.length === 0) {
    const active = await prisma.userActiveCountry.findMany({
      where: { userId },
      select: { countryId: true },
    });
    countryIds = active.map((ac) => ac.countryId);
  }

  // 3. Date window.
  const dateFilter: { gte?: number; lte?: number } = {};
  if (opts.startDate !== undefined || opts.endDate !== undefined) {
    if (opts.startDate !== undefined) dateFilter.gte = opts.startDate;
    if (opts.endDate !== undefined) dateFilter.lte = opts.endDate;
  } else if (upcomingOnly) {
    dateFilter.gte = now;
  }

  // 4. Build the where clause and query the GLOBAL concert table.
  const where: any = {
    artists: { some: { artistId: { in: queryArtistIds } } },
  };
  if (Object.keys(dateFilter).length > 0) where.dateStart = dateFilter;
  if (countryIds.length > 0) where.countryId = { in: countryIds };
  if (opts.countryName) where.countryObj = { name: opts.countryName };
  if (opts.city) where.cityMapping = { originalCity: opts.city };

  const concerts = await prisma.concert.findMany({
    where,
    include: {
      artists: {
        include: { artist: true },
        orderBy: { isPrimary: 'desc' },
      },
      cityMapping: {
        include: { cityNormalized: { include: { country: true } } },
      },
      countryObj: true,
    },
    orderBy: { dateStart: 'asc' },
  });

  // 5. Left-join the user's interaction state (UserConcert) for these concerts.
  const userConcerts = concerts.length
    ? await prisma.userConcert.findMany({
        where: { userId, concertId: { in: concerts.map((c) => c.id) } },
      })
    : [];
  const ucMap = new Map(userConcerts.map((uc) => [uc.concertId, uc]));

  // 6. Shape (merge interaction state + per-artist playcounts + primary artist).
  const shaped: RelevantConcert[] = concerts.map((concert: any) => {
    const uc = ucMap.get(concert.id);
    const artists = concert.artists.map((ac: any) => {
      const stats = statsMap.get(ac.artistId);
      return {
        id: ac.id,
        artistId: ac.artistId,
        concertId: ac.concertId,
        isPrimary: ac.isPrimary,
        artist: {
          ...ac.artist,
          playcount: stats?.playcount ?? 0,
          playcount12month: stats?.playcount12month ?? 0,
          recent: stats?.recent ?? false,
          followed: statsMap.has(ac.artistId),
        } as RelevantArtist,
      };
    });
    const primary = artists.find((a: any) => a.isPrimary) || artists[0];
    return {
      ...concert,
      interested: uc?.interested ?? false,
      notes: uc?.notes ?? null,
      isPrivate: uc?.isPrivate ?? false,
      artistId: primary?.artistId,
      artist: primary?.artist ?? null,
      artists,
    };
  });

  return { concerts: shaped, followedArtistIds };
}
