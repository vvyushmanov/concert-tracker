import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
        artist: true,
      },
    });

    if (!concert) {
      return NextResponse.json(
        { error: 'Concert not found' },
        { status: 404 }
      );
    }

    // Parse JSON fields
    const concertWithParsedData = {
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
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
    const { id } = await params;
    const concertId = parseInt(id);
    
    if (isNaN(concertId)) {
      return NextResponse.json(
        { error: 'Invalid concert ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { interested, notes } = body;

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

    // Update concert
    const updatedConcert = await prisma.concert.update({
      where: { id: concertId },
      data: {
        ...(interested !== undefined && { interested }),
        ...(notes !== undefined && { notes }),
        updatedAt: Math.floor(Date.now() / 1000),
      },
      include: {
        artist: true,
      },
    });

    // Parse JSON fields
    const concertWithParsedData = {
      ...updatedConcert,
      performers: JSON.parse(updatedConcert.performers),
      ticketLinks: JSON.parse(updatedConcert.ticketLinks),
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
