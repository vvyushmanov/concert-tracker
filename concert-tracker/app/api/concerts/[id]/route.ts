import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id } = await params;
    const concertId = parseInt(id);
    
    if (isNaN(concertId)) {
      return NextResponse.json(
        { error: 'Invalid concert ID' },
        { status: 400 }
      );
    }

    const concert = await prisma.concert.findUnique({
      where: { id: concertId },
      include: {
        artists: {
          include: {
            artist: true,
          },
          orderBy: {
            isPrimary: 'desc', // Primary artist first
          },
        },
        cityMapping: {
          include: {
            cityNormalized: {
              include: { country: true }
            }
          }
        },
        countryObj: true,
        userInteractions: session ? {
          where: { userId: parseInt(session.user.id) },
          select: { interested: true, notes: true, isPrivate: true }
        } : false,
      },
    });

    if (!concert) {
      return NextResponse.json(
        { error: 'Concert not found' },
        { status: 404 }
      );
    }

    // Get user's artist stats if logged in
    let artistStatsMap = new Map();
    if (session) {
      const userId = parseInt(session.user.id);
      const artistIds = concert.artists.map((ac: any) => ac.artistId);
      
      const userArtistStats = await prisma.userArtist.findMany({
        where: {
          userId,
          artistId: { in: artistIds }
        }
      });
      
      artistStatsMap = new Map(
        userArtistStats.map((ua: any) => [ua.artistId, ua])
      );
    }

    // Merge user-specific data
    const userInteraction = concert.userInteractions?.[0];
    
    // Parse JSON fields and transform artists array
    const concertWithParsedData = {
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
      interested: userInteraction?.interested || false,
      notes: userInteraction?.notes || '',
      isPrivate: userInteraction?.isPrivate || false,
      userInteractions: undefined, // Remove from response
      // Transform artists array with user stats
      artists: concert.artists.map((ac: any) => ({
        id: ac.id,
        artistId: ac.artistId,
        concertId: ac.concertId,
        isPrimary: ac.isPrimary,
        artist: {
          ...ac.artist,
          playcount: artistStatsMap.get(ac.artistId)?.playcount || 0,
        },
      })),
    };

    return NextResponse.json(concertWithParsedData);
  } catch (error) {
    console.error('Error fetching concert:', error);
    return NextResponse.json(
      { error: 'Failed to fetch concert' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const concertId = parseInt(id);
    const userId = parseInt(session.user.id);
    
    if (isNaN(concertId)) {
      return NextResponse.json(
        { error: 'Invalid concert ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { interested, notes, isPrivate } = body;

    // Validate input
    if (interested !== undefined && typeof interested !== 'boolean') {
      return NextResponse.json(
        { error: 'interested must be a boolean' },
        { status: 400 }
      );
    }

    if (notes !== undefined && typeof notes !== 'string') {
      return NextResponse.json(
        { error: 'notes must be a string' },
        { status: 400 }
      );
    }

    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      return NextResponse.json(
        { error: 'isPrivate must be a boolean' },
        { status: 400 }
      );
    }

    const now = Math.floor(Date.now() / 1000);

    // Upsert into UserConcert table
    await prisma.userConcert.upsert({
      where: {
        userId_concertId: { userId, concertId }
      },
      update: {
        ...(interested !== undefined && { interested }),
        ...(notes !== undefined && { notes }),
        ...(isPrivate !== undefined && { isPrivate }),
        updatedAt: now,
      },
      create: {
        userId,
        concertId,
        interested: interested ?? false,
        notes: notes ?? '',
        isPrivate: isPrivate ?? false,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Fetch updated concert with user data
    const concert = await prisma.concert.findUnique({
      where: { id: concertId },
      include: {
        artists: {
          include: {
            artist: true,
          },
          orderBy: {
            isPrimary: 'desc', // Primary artist first
          },
        },
        cityMapping: {
          include: {
            cityNormalized: {
              include: { country: true }
            }
          }
        },
        countryObj: true,
        userInteractions: {
          where: { userId },
          select: { interested: true, notes: true, isPrivate: true }
        },
      },
    });

    if (!concert) {
      return NextResponse.json(
        { error: 'Concert not found' },
        { status: 404 }
      );
    }

    const userInteraction = concert.userInteractions[0];

    // Parse JSON fields and transform artists array
    const concertWithParsedData = {
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
      interested: userInteraction?.interested || false,
      notes: userInteraction?.notes || '',
      isPrivate: userInteraction?.isPrivate || false,
      userInteractions: undefined,
      // Transform artists array
      artists: concert.artists.map((ac: any) => ({
        id: ac.id,
        artistId: ac.artistId,
        concertId: ac.concertId,
        isPrimary: ac.isPrimary,
        artist: ac.artist,
      })),
    };

    return NextResponse.json(concertWithParsedData);
  } catch (error) {
    console.error('Error updating concert:', error);
    return NextResponse.json(
      { error: 'Failed to update concert' },
      { status: 500 }
    );
  }
}
