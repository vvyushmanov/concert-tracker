import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = parseInt(session.user.id);
    const isAdmin = session.user.role === 'ADMIN';
    
    // Parse request body for debug flag
    let debug = false;
    try {
      const body = await request.json();
      debug = body.debug === true && isAdmin; // Only admins can use debug mode
    } catch {
      // No body or invalid JSON, use default
    }
    
    const { scannerState } = await import('../../state');
    
    // Check if user already has a scan running
    const userState = scannerState.get(userId);
    if (userState?.isScanning) {
      return NextResponse.json({
        success: false,
        error: 'You already have a scan in progress',
      }, { status: 409 });
    }
    
    // Start the scan in the background with user ID and optional debug flag
    const { startScan } = await import('../../scanner');
    startScan(userId, debug);
    
    return NextResponse.json({
      success: true,
      message: debug 
        ? 'Scan started in DEBUG mode with your personal settings'
        : 'Scan started with your personal settings',
    });
  } catch (error) {
    console.error('Failed to start scan:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to start scan',
    }, { status: 500 });
  }
}
