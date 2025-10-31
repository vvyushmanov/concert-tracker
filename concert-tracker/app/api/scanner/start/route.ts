import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const { scannerState } = await import('../../state');
    
    if (scannerState.isScanning) {
      return NextResponse.json({
        success: false,
        error: 'A scan is already in progress',
      }, { status: 400 });
    }
    
    // Start the scan in the background
    const { startScan } = await import('../../scanner');
    startScan();
    
    return NextResponse.json({
      success: true,
      message: 'Scan started',
    });
  } catch (error) {
    console.error('Failed to start scan:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to start scan',
    }, { status: 500 });
  }
}
