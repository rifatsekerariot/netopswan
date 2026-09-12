import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/password-hash';
import { successResponse, errorResponse, ErrorCodes } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    const { username, oldPassword, newPassword } = await req.json();

    if (!username || !oldPassword || !newPassword) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'Username, current password, and new password are required',
        400
      );
      return NextResponse.json(response, { status });
    }

    if (newPassword.length < 12) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'New password must be at least 12 characters',
        400
      );
      return NextResponse.json(response, { status });
    }

    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Password requirements: ${strengthCheck.errors.join(', ')}`,
        400
      );
      return NextResponse.json(response, { status });
    }

    if (oldPassword === newPassword) {
      const { response, status } = errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        'New password must be different from current password',
        400
      );
      return NextResponse.json(response, { status });
    }

    const pool = getDbPool();

    // Verify current password
    const userRes = await pool.query(
      'SELECT id, password_hash FROM netops_users WHERE username = $1 LIMIT 1',
      [username]
    );

    if (userRes.rows.length === 0) {
      const { response, status } = errorResponse(
        ErrorCodes.USER_NOT_FOUND,
        'User not found',
        404
      );
      return NextResponse.json(response, { status });
    }

    const user = userRes.rows[0];
    const isPasswordValid = await verifyPassword(oldPassword, user.password_hash);

    if (!isPasswordValid) {
      const { response, status } = errorResponse(
        ErrorCodes.INVALID_CREDENTIALS,
        'Current password is incorrect',
        401
      );
      return NextResponse.json(response, { status });
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password (netops_users tablosunda updated_at kolonu yok - schema.sql'e bakınız)
    await pool.query(
      'UPDATE netops_users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, user.id]
    );

    return NextResponse.json(
      successResponse(
        { username },
        'Password changed successfully'
      )
    );
  } catch (error: any) {
    console.error('Change password error:', error);
    const { response, status } = errorResponse(
      ErrorCodes.INTERNAL_ERROR,
      'An error occurred while changing password',
      500
    );
    return NextResponse.json(response, { status });
  }
}
