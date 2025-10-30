import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [totalConcerts, totalArtists, countries, cities] = await Promise.all([
      prisma.concert.count(),
      prisma.artist.count(),
      prisma.concert.groupBy({
        by: ['country'],
        _count: true,
      }),
      prisma.concert.groupBy({
        by: ['city'],
        _count: true,
        orderBy: {
          _count: {
            city: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    return NextResponse.json({
      totalConcerts,
      totalArtists,
      countries: countries.map(c => ({ country: c.country, count: c._count })),
      topCities: cities.map(c => ({ city: c.city, count: c._count })),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}
