import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Scanning now populates the GLOBAL concert table only — it is no longer a
    // per-user operation (preferences are applied at read time). It is therefore
    // an admin maintenance action. (M2's desktop agent will replace it entirely.)
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({
        success: false,
        error: 'Scanning is an admin-only operation. Manage your concerts via your followed artists and active countries instead.',
      }, { status: 403 });
    }

    const userId = parseInt(session.user.id);

    // Only flag left is debug verbosity; the scan is always a global, unfiltered
    // population (--no-filter, user_id=None → no per-user rows materialized).
    let debug = false;
    try {
      const body = await request.json();
      debug = body.debug === true;
    } catch {
      // No body or invalid JSON, use default
    }

    const { scannerState } = await import('../../state');

    // Check if this admin already has a scan running or stopping
    const userState = scannerState.get(userId);
    if (userState?.isScanning || userState?.isStopping) {
      return NextResponse.json({
        success: false,
        error: userState?.isStopping
          ? 'Previous scan is stopping. Please wait for it to complete.'
          : 'A scan is already in progress',
      }, { status: 409 });
    }

    // Start the global scan in the background
    const { startScan } = await import('../../scanner');
    startScan(userId, debug);

    return NextResponse.json({
      success: true,
      message: debug
        ? 'Global scan started in DEBUG mode (all concerts, no filtering)'
        : 'Global scan started (all concerts, no filtering)',
    });
  } catch (error) {
    console.error('Failed to start scan:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to start scan',
    }, { status: 500 });
  }
}
