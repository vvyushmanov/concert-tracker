import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function POST() {
  try {
    const session = await auth();
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const { scannerState, stopScan } = await import('../../state');
    
    const userState = scannerState.get(userId);
    if (!userState?.isScanning) {
      return NextResponse.json({
        success: false,
        error: 'No scan is currently running',
      }, { status: 400 });
    }
    
    stopScan(userId);
    
    return NextResponse.json({
      success: true,
      message: 'Scan stopped',
    });
  } catch (error) {
    console.error('Failed to stop scan:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to stop scan',
    }, { status: 500 });
  }
}
