import { NextResponse } from 'next/server';
import { metadataState } from '../../state';

export async function GET() {
  return NextResponse.json({ 
    isRefreshing: metadataState.isRefreshing 
  });
}
