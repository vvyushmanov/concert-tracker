import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { scannerState, addLogListener, removeLogListener } = await import('../../state');
  
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
            removeLogListener(listener);
            controller.close();
          }
        } catch (error) {
          // Controller already closed, just cleanup
          isClosed = true;
          removeLogListener(listener);
        }
      };
      
      addLogListener(listener);
      
      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        if (!isClosed) {
          isClosed = true;
          removeLogListener(listener);
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
