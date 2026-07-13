/**
 * Thin proxy: forwards to `/api/v1/bulk-save/`.
 * Proxies bulk resource changes to the backend API.
 */
import { NextRequest, NextResponse } from 'next/server';
import { proxyToApi } from '@/lib/api/server-proxy';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { status, data } = await proxyToApi(request, '/api/v1/bulk-save/', {
      method: 'POST',
      body,
    });
    return NextResponse.json(data ?? {}, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logger.error('bulk-save proxy error', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
