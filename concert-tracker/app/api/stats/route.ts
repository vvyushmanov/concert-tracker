import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [totalConcerts, totalArtists, countries, cities] = await Promise.all([
      prisma.concert.count(),
      prisma.artist.count(),
      prisma.concert.groupBy({
        by: ['countryId'],
        _count: true,
      }),
      prisma.concert.groupBy({
        by: ['cityMappingId'],
        _count: true,
        orderBy: {
          _count: {
            cityMappingId: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    // Fetch city names for top cities
    const cityMappingIds = cities.map(c => c.cityMappingId).filter(id => id !== null) as number[];
    const cityMappings = await prisma.cityMapping.findMany({
      where: { id: { in: cityMappingIds } },
      select: {
        id: true,
        cityNormalized: {
          select: {
            normalizedCity: true
          }
        }
      }
    });
    
    const cityNameMap = new Map(
      cityMappings.map(cm => [cm.id, cm.cityNormalized?.normalizedCity || 'Unknown'])
    );

    return NextResponse.json({
      totalConcerts,
      totalArtists,
      countries: countries.map(c => ({ countryId: c.countryId, count: c._count })),
      topCities: cities.map(c => ({ 
        cityMappingId: c.cityMappingId,
        city: cityNameMap.get(c.cityMappingId!) || 'Unknown',
        count: c._count 
      })),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    );
  }
}
