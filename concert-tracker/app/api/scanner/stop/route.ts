import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const { scannerState, stopScan } = await import('../../state');
    
    if (!scannerState.isScanning) {
      return NextResponse.json({
        success: false,
        error: 'No scan is currently running',
      }, { status: 400 });
    }
    
    stopScan();
    
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
