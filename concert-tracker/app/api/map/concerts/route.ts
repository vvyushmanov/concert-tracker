import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { getRelevantConcerts } from '@/lib/concerts';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const now = Math.floor(Date.now() / 1000);
    const startDate = parseInt(searchParams.get('startDate') || String(now));
    const endDate = parseInt(searchParams.get('endDate') || String(now + 7776000)); // Default: 90 days
    const friendIds = searchParams.get('friendIds')?.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id)) || [];
    const artistIds = searchParams.get('artistIds')?.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id)) || [];
    const countryIds = searchParams.get('countryIds')?.split(',').map((id) => parseInt(id)).filter((id) => !isNaN(id)) || [];
    const interestedOnly = searchParams.get('interestedOnly') === 'true';

    // Validate friend limit (max 5)
    if (friendIds.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 friends can be selected' }, { status: 400 });
    }

    // Effective country scope: explicit request, else the user's active countries.
    let effectiveCountryIds = countryIds;
    if (effectiveCountryIds.length === 0) {
      const activeCountries = await prisma.userActiveCountry.findMany({
        where: { userId },
        select: { countryId: true },
      });
      effectiveCountryIds = activeCountries.map((ac) => ac.countryId);
    }

    // Current user's username (for their own interaction entries).
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const myUsername = me?.username || 'me';

    // Privacy settings (friends only; the user always sees their own).
    const friendPrivacySettings = await prisma.userSetting.findMany({
      where: { userId: { in: friendIds }, key: 'MAP_PRIVACY_GLOBAL' },
    });
    const friendPrivacyMap = new Map(friendPrivacySettings.map((s) => [s.userId, s.value === 'true']));

    // 1) The user's OWN relevant concerts (read-time personalization).
    const { concerts: ownConcerts } = await getRelevantConcerts(userId, {
      startDate,
      endDate,
      upcomingOnly: false,
      countryIds: effectiveCountryIds.length ? effectiveCountryIds : undefined,
      artistIds: artistIds.length ? artistIds : undefined,
    });

    // 2) Friends' interested concerts within the same window/scope.
    const friendConcerts = friendIds.length
      ? await prisma.concert.findMany({
          where: {
            dateStart: { gte: startDate, lte: endDate },
            ...(effectiveCountryIds.length > 0 && { countryId: { in: effectiveCountryIds } }),
            ...(artistIds.length > 0 && { artists: { some: { artistId: { in: artistIds } } } }),
            userInteractions: { some: { userId: { in: friendIds }, interested: true } },
          },
          include: {
            artists: {
              include: { artist: { select: { id: true, name: true, imageUrl: true } } },
              orderBy: { isPrimary: 'desc' },
            },
            cityMapping: {
              select: {
                id: true,
                originalCity: true,
                latitude: true,
                longitude: true,
                cityNormalized: { select: { normalizedCity: true } },
              },
            },
            countryObj: { select: { id: true, name: true, code: true } },
            userInteractions: {
              where: { userId: { in: friendIds } },
              select: { userId: true, interested: true, isPrivate: true, user: { select: { username: true } } },
            },
          },
        })
      : [];

    // 3) Merge own + friend concerts, keyed by concert id.
    type Inter = { userId: number; username: string; interested: boolean; isPrivate: boolean };
    const merged = new Map<number, { concert: any; interactions: Map<number, Inter> }>();

    for (const c of ownConcerts) {
      // The user's own layer respects interestedOnly.
      if (interestedOnly && !c.interested) continue;
      const entry = merged.get(c.id) || { concert: c, interactions: new Map<number, Inter>() };
      entry.interactions.set(userId, { userId, username: myUsername, interested: c.interested, isPrivate: c.isPrivate });
      merged.set(c.id, entry);
    }
    for (const c of friendConcerts as any[]) {
      const entry = merged.get(c.id) || { concert: c, interactions: new Map<number, Inter>() };
      for (const ui of c.userInteractions) {
        entry.interactions.set(ui.userId, {
          userId: ui.userId,
          username: ui.user.username,
          interested: ui.interested,
          isPrivate: ui.isPrivate,
        });
      }
      merged.set(c.id, entry);
    }

    // 4) Shape output + apply privacy filtering.
    const processedConcerts = Array.from(merged.values())
      .map(({ concert, interactions }) => {
        const coords = concert.cityMapping
          ? { lat: concert.cityMapping.latitude || '0', lng: concert.cityMapping.longitude || '0' }
          : null;

        const visibleInteractions = Array.from(interactions.values()).filter((intr) => {
          if (intr.userId === userId) return true; // self always visible
          if (friendPrivacyMap.get(intr.userId)) return false; // friend global privacy
          if (intr.isPrivate) return false; // per-concert privacy
          return true;
        });

        if (visibleInteractions.length === 0) return null;

        return {
          id: concert.id,
          eventName: concert.eventName,
          eventUrl: concert.eventUrl,
          dateStart: concert.dateStart,
          dateEnd: concert.dateEnd,
          venue: concert.venue,
          city: concert.cityMapping?.originalCity || 'Unknown',
          normalizedCity: concert.cityMapping?.cityNormalized?.normalizedCity || 'Unknown',
          cityMapping: concert.cityMapping
            ? {
                originalCity: concert.cityMapping.originalCity,
                cityNormalized: concert.cityMapping.cityNormalized
                  ? { normalizedCity: concert.cityMapping.cityNormalized.normalizedCity }
                  : undefined,
              }
            : undefined,
          country: concert.countryObj,
          artists: concert.artists.map((ac: any) => ({
            id: ac.id,
            artistId: ac.artistId,
            isPrimary: ac.isPrimary,
            artist: ac.artist,
          })),
          imageUrl: concert.imageUrl,
          coordinates: coords ? { lat: parseFloat(coords.lat || '0'), lng: parseFloat(coords.lng || '0') } : null,
          userInteractions: visibleInteractions.map((ui) => ({
            userId: ui.userId,
            username: ui.username,
            interested: ui.interested,
          })),
        };
      })
      .filter((concert) => concert !== null);

    return NextResponse.json({
      concerts: processedConcerts,
      meta: {
        total: processedConcerts.length,
        dateRange: { startDate, endDate },
        userCount: [userId, ...friendIds].length,
      },
    });
  } catch (error) {
    console.error('Error fetching map concerts:', error);
    return NextResponse.json({ error: 'Failed to fetch concert data' }, { status: 500 });
  }
}
