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
      isStopping: false,
      process: null,
      listeners: [],
      startTime: 0,
      lastStats: null
    });
  }
  
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      
      // Send initial state to newly connected client
      const userState = scannerState.get(userId);
      if (userState) {
        const initialState = {
          type: 'state',
          isScanning: userState.isScanning,
          isStopping: userState.isStopping,
          stats: userState.lastStats
        };
        const data = `data: ${JSON.stringify(initialState)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      
      // Create listener for log and state updates
      const listener = (message: string, type: 'log' | 'complete' | 'error' | 'state', stats?: any) => {
        if (isClosed) return; // Don't try to send if already closed
        
        try {
          let payload;
          
          if (type === 'state') {
            // State messages: spread the state data directly into payload
            payload = { type: 'state', ...stats };
          } else if (stats) {
            // Log/complete/error messages with stats
            payload = { type, message, stats };
          } else {
            // Simple log messages
            payload = { type, message };
          }
          
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
