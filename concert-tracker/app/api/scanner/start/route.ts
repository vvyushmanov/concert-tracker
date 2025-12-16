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

    // Parse request body for debug and globalScan flags
    let debug = false;
    let globalScan = false;
    try {
      const body = await request.json();
      debug = body.debug === true && isAdmin; // Only admins can use debug mode
      globalScan = body.globalScan === true && isAdmin; // Only admins can use global scan
    } catch {
      // No body or invalid JSON, use default
    }
    
    const { scannerState } = await import('../../state');
    
    // Check if user already has a scan running or stopping
    const userState = scannerState.get(userId);
    if (userState?.isScanning || userState?.isStopping) {
      return NextResponse.json({
        success: false,
        error: userState?.isStopping 
          ? 'Previous scan is stopping. Please wait for it to complete.'
          : 'You already have a scan in progress',
      }, { status: 409 });
    }
    
    // Start the scan in the background with user ID and optional flags
    const { startScan } = await import('../../scanner');
    startScan(userId, debug, globalScan);

    return NextResponse.json({
      success: true,
      message: globalScan
        ? (debug ? 'Global scan started in DEBUG mode (all concerts, no filtering)' : 'Global scan started (all concerts, no filtering)')
        : (debug ? 'Scan started in DEBUG mode with your personal settings' : 'Scan started with your personal settings'),
    });
  } catch (error) {
    console.error('Failed to start scan:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to start scan',
    }, { status: 500 });
  }
}
