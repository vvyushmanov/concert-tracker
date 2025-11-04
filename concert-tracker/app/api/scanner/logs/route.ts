import { NextRequest } from 'next/server';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const { scannerState, addLogListener, removeLogListener } = await import('../../state');
  
  // Initialize user state if it doesn't exist
  if (!scannerState.has(userId)) {
    scannerState.set(userId, {
      isScanning: false,
      process: null,
      listeners: [],
      startTime: 0
    });
  }
  
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      
      // Send initial connection message
      const data = `data: ${JSON.stringify({ type: 'connected' })}\n\n`;
      controller.enqueue(encoder.encode(data));
      
      // Create listener for log updates
      const listener = (message: string, type: 'log' | 'complete' | 'error', stats?: any) => {
        if (isClosed) return; // Don't try to send if already closed
        
        try {
          const payload = stats 
            ? { type, message, stats }
            : { type, message };
          const data = `data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(data));
          
          if (type === 'complete' || type === 'error') {
            isClosed = true;
            removeLogListener(userId, listener);
            controller.close();
          }
        } catch (error) {
          // Controller already closed, just cleanup
          isClosed = true;
          removeLogListener(userId, listener);
        }
      };
      
      addLogListener(userId, listener);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        if (!isClosed) {
          isClosed = true;
          removeLogListener(userId, listener);
          try {
            controller.close();
          } catch (error) {
            // Already closed, ignore
          }
        }
      });
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
