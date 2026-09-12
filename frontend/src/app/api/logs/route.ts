import { NextRequest, NextResponse } from 'next/server';
import { SDWAN_HUB_URL } from '@/lib/hub';
import { errorResponse, ErrorCodes } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') || '100';
    // Şube 360° görünümü: bir cihazın loglarını tek başına görüntülemek için.
    const deviceId = searchParams.get('device_id');

    const hubParams = new URLSearchParams({ limit });
    if (deviceId) hubParams.set('device_id', deviceId);

    const res = await fetch(`${SDWAN_HUB_URL}/api/v1/sdwan/logs?${hubParams.toString()}`, {
      cache: 'no-store'
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ count: 0, results: [] });
  } catch (err: any) {
    const { response, status } = errorResponse(ErrorCodes.INTERNAL_ERROR, err.message, 500);
    return NextResponse.json({ ...response, count: 0, results: [] }, { status });
  }
}
