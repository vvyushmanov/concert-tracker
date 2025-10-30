import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Revalidate all main pages
    revalidatePath('/', 'layout');
    revalidatePath('/artists');
    revalidatePath('/countries');
    revalidatePath('/calendar');
    
    return NextResponse.json({ 
      revalidated: true, 
      message: 'All pages revalidated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({ 
      revalidated: false, 
      message: 'Error revalidating',
      error: err instanceof Error ? err.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: 'Use POST to trigger revalidation',
    usage: 'curl -X POST http://localhost:3000/api/revalidate'
  });
}
