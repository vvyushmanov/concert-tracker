import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Fetch all concerts with artist data
    const concerts = await prisma.concert.findMany({
      include: {
        artist: true,
        countryObj: true,
      },
      orderBy: {
        dateStart: 'asc',
      },
    });

    // Group concerts by country and artist (matching original JSON format)
    const exportData: Record<string, Record<string, any>> = {};

    for (const concert of concerts) {
      const country = concert.countryObj?.name;
      const artistName = concert.artist.name;

      // Initialize country if not exists
      if (!exportData[country]) {
        exportData[country] = {};
      }

      // Initialize artist if not exists
      if (!exportData[country][artistName]) {
        exportData[country][artistName] = {
          playcount: concert.artist.playcount,
          recent: concert.artist.recent,
          concerts: [],
        };
      }

      // Add concert to artist's concerts
      exportData[country][artistName].concerts.push({
        event_name: concert.eventName,
        event_url: concert.eventUrl,
        date_start: new Date(concert.dateStart * 1000).toISOString().split('T')[0],
        date_end: new Date(concert.dateEnd * 1000).toISOString().split('T')[0],
        venue: concert.venue,
        city: concert.city,
        postal_code: concert.postalCode || '',
        performers: JSON.parse(concert.performers),
        image_url: concert.imageUrl || '',
        organizer: concert.organizer || '',
        organizer_url: concert.organizerUrl || '',
        ticket_links: JSON.parse(concert.ticketLinks),
      });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `concerts_export_${timestamp}.json`;

    // Return JSON file
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
