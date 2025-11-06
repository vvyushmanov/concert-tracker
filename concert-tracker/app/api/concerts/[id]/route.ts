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
        artist: true,
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

    // Merge user-specific data
    const userInteraction = concert.userInteractions?.[0];
    
    // Parse JSON fields
    const concertWithParsedData = {
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
      interested: userInteraction?.interested || false,
      notes: userInteraction?.notes || '',
      isPrivate: userInteraction?.isPrivate || false,
      userInteractions: undefined, // Remove from response
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
        artist: true,
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

    // Parse JSON fields
    const concertWithParsedData = {
      ...concert,
      performers: JSON.parse(concert.performers),
      ticketLinks: JSON.parse(concert.ticketLinks),
      interested: userInteraction?.interested || false,
      notes: userInteraction?.notes || '',
      isPrivate: userInteraction?.isPrivate || false,
      userInteractions: undefined,
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
