import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { scannerState } = await import('../../state');
    
    const userState = scannerState.get(userId);
    
    return NextResponse.json({
      isScanning: userState?.isScanning ?? false,
    });
  } catch (error) {
    console.error('Failed to get scan status:', error);
    return NextResponse.json({
      isScanning: false,
    });
  }
}
