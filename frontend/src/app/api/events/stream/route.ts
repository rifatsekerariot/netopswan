import { NextRequest } from 'next/server';
import { SDWAN_HUB_URL } from '@/lib/hub';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const hubUrl = `${SDWAN_HUB_URL}/api/v1/sdwan/events/stream`;
    const response = await fetch(hubUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok || !response.body) {
      return new Response('Event SSE Stream unavailable', { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response('Event SSE connection error', { status: 500 });
  }
}
