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

    // Fetch concerts with artist data
    const concerts = await prisma.concert.findMany({
      where,
      include: {
        artist: true,
      },
      orderBy: {
        dateStart: 'asc',
      },
      take: limit,
      skip: offset,
    });

    // Get total count
    const total = await prisma.concert.count({ where });

    // Parse JSON fields
    const concertsWithParsedData = concerts.map(concert => ({
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
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
