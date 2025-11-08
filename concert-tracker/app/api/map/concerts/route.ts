import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = parseInt(session.user.id);
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const now = Math.floor(Date.now() / 1000);
    const startDate = parseInt(searchParams.get('startDate') || String(now));
    const endDate = parseInt(searchParams.get('endDate') || String(now + 7776000)); // Default: 90 days from now
    const friendIds = searchParams.get('friendIds')?.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) || [];
    const artistIds = searchParams.get('artistIds')?.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) || [];
    const countryIds = searchParams.get('countryIds')?.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) || [];
    const interestedOnly = searchParams.get('interestedOnly') === 'true';

    // Validate friend limit (max 5)
    if (friendIds.length > 5) {
      return NextResponse.json(
        { error: 'Maximum 5 friends can be selected' },
        { status: 400 }
      );
    }

    // Get user's global privacy setting
    const userPrivacySetting = await prisma.userSetting.findUnique({
      where: {
        userId_key: {
          userId,
          key: 'MAP_PRIVACY_GLOBAL'
        }
      }
    });
    const userGlobalPrivacy = userPrivacySetting?.value === 'true';

    // Get user's active countries if no specific countries requested
    let activeCountryIds = countryIds;
    if (activeCountryIds.length === 0) {
      const activeCountries = await prisma.userActiveCountry.findMany({
        where: { userId },
        select: { countryId: true }
      });
      activeCountryIds = activeCountries.map(ac => ac.countryId);
    }

    // Build user IDs to query (current user + selected friends)
    const userIdsToQuery = [userId, ...friendIds];

    // Fetch concerts with user interactions
    const concerts = await prisma.concert.findMany({
      where: {
        dateStart: {
          gte: startDate,
          lte: endDate
        },
        ...(activeCountryIds.length > 0 && {
          countryId: { in: activeCountryIds }
        }),
        ...(artistIds.length > 0 && {
          artists: {
            some: {
              artistId: { in: artistIds }
            }
          }
        }),
        userInteractions: {
          some: {
            userId: { in: userIdsToQuery },
            ...(interestedOnly && { interested: true })
          }
        }
      },
      include: {
        artists: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
                imageUrl: true
              }
            }
          },
          orderBy: {
            isPrimary: 'desc'
          }
        },
        cityMapping: {
          select: {
            id: true,
            originalCity: true,
            latitude: true,
            longitude: true,
            cityNormalized: {
              select: {
                normalizedCity: true
              }
            }
          }
        },
        countryObj: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        userInteractions: {
          where: {
            userId: { in: userIdsToQuery }
          },
          select: {
            userId: true,
            interested: true,
            isPrivate: true,
            user: {
              select: {
                username: true
              }
            }
          }
        }
      }
    });

    // Coordinates are now included directly via cityMapping relation
    // No need for separate lookup

    // Get friend privacy settings
    const friendPrivacySettings = await prisma.userSetting.findMany({
      where: {
        userId: { in: friendIds },
        key: 'MAP_PRIVACY_GLOBAL'
      }
    });
    const friendPrivacyMap = new Map(
      friendPrivacySettings.map(s => [s.userId, s.value === 'true'])
    );

    // Process concerts and apply privacy filtering
    const processedConcerts = concerts
      .map(concert => {
        // Get coordinates from cityMapping (already included)
        const coords = concert.cityMapping ? {
          lat: concert.cityMapping.latitude || '0',
          lng: concert.cityMapping.longitude || '0'
        } : null;
        
        // Filter user interactions based on privacy
        const visibleInteractions = concert.userInteractions.filter(interaction => {
          // Current user's concerts are always visible to them
          if (interaction.userId === userId) {
            return true;
          }
          
          // Check if friend has global privacy enabled
          const friendGlobalPrivacy = friendPrivacyMap.get(interaction.userId) || false;
          if (friendGlobalPrivacy) {
            return false;
          }
          
          // Check per-concert privacy
          if (interaction.isPrivate) {
            return false;
          }
          
          return true;
        });

        // Skip concert if no visible interactions
        if (visibleInteractions.length === 0) {
          return null;
        }

        return {
          id: concert.id,
          eventName: concert.eventName,
          eventUrl: concert.eventUrl,
          dateStart: concert.dateStart,
          dateEnd: concert.dateEnd,
          venue: concert.venue,
          city: concert.cityMapping?.originalCity || 'Unknown',
          normalizedCity: concert.cityMapping?.cityNormalized?.normalizedCity || 'Unknown',
          cityMapping: concert.cityMapping ? {
            originalCity: concert.cityMapping.originalCity,
            cityNormalized: concert.cityMapping.cityNormalized ? {
              normalizedCity: concert.cityMapping.cityNormalized.normalizedCity
            } : undefined
          } : undefined,
          country: concert.countryObj,
          artists: concert.artists.map((ac: any) => ({
            id: ac.id,
            artistId: ac.artistId,
            isPrimary: ac.isPrimary,
            artist: ac.artist
          })),
          imageUrl: concert.imageUrl,
          coordinates: coords ? {
            lat: parseFloat(coords.lat || '0'),
            lng: parseFloat(coords.lng || '0')
          } : null,
          userInteractions: visibleInteractions.map(ui => ({
            userId: ui.userId,
            username: ui.user.username,
            interested: ui.interested
          }))
        };
      })
      .filter(concert => concert !== null);

    return NextResponse.json({
      concerts: processedConcerts,
      meta: {
        total: processedConcerts.length,
        dateRange: { startDate, endDate },
        userCount: userIdsToQuery.length
      }
    });
  } catch (error) {
    console.error('Error fetching map concerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch concert data' },
      { status: 500 }
    );
  }
}
