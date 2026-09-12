import { NextRequest, NextResponse } from 'next/server';
import { SDWAN_HUB_URL } from '@/lib/hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const hubUrl = `${SDWAN_HUB_URL}/api/v1/sdwan/allowlist`;
    const res = await fetch(hubUrl);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ allowlist: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const hubUrl = `${SDWAN_HUB_URL}/api/v1/sdwan/allowlist`;
    const res = await fetch(hubUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
