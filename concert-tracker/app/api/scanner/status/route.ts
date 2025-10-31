import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { scannerState } = await import('../../state');
    
    return NextResponse.json({
      isScanning: scannerState.isScanning,
    });
  } catch (error) {
    console.error('Failed to get scan status:', error);
    return NextResponse.json({
      isScanning: false,
    });
  }
}
