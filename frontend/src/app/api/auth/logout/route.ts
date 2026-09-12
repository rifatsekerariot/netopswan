import { NextRequest, NextResponse } from 'next/server';
import { successResponse } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  const response = NextResponse.json(
    successResponse(null, 'Logged out successfully')
  );

  response.cookies.delete('netopswan_token');
  response.cookies.delete('netopswan_user');

  return response;
}
