import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryName = searchParams.get('country');
    const city = searchParams.get('city');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause
    const where: any = {};
    if (countryName) {
      where.countryObj = {
        name: countryName
      };
    }
    if (city) where.city = city;

    // Fetch concerts with artists via junction table
    const concerts = await prisma.concert.findMany({
      where,
      include: {
        artists: {
          include: {
            artist: true,
          },
          orderBy: {
            isPrimary: 'desc', // Primary artist first
          },
        },
      },
      orderBy: {
        dateStart: 'asc',
      },
      take: limit,
      skip: offset,
    });

    // Get total count
    const total = await prisma.concert.count({ where });

    // Parse JSON fields and transform artists array
    const concertsWithParsedData = concerts.map((concert: any) => ({
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
      // Transform artists array to include artist data
      artists: concert.artists.map((ac: any) => ({
        id: ac.id,
        artistId: ac.artistId,
        concertId: ac.concertId,
        isPrimary: ac.isPrimary,
        artist: ac.artist,
      })),
    }));

    return NextResponse.json({
      concerts: concertsWithParsedData,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching concerts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch concerts' },
      { status: 500 }
    );
  }
}
