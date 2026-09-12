import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Password hashing helper using bcryptjs with fallback to PBKDF2
export async function hashPassword(password: string): Promise<string> {
  try {
    return await bcrypt.hash(password, 12);
  } catch (err) {
    console.warn('bcryptjs hashing failed, falling back to PBKDF2:', err);
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 100000;
    const keyLength = 64;
    const digest = 'sha256';

    const hash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString('hex');
    return `$pbkdf2$${iterations}$${salt}$${hash}`;
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    if (hash.startsWith('$pbkdf2$')) {
      // PBKDF2 format
      const [, , iterStr, salt, storedHash] = hash.split('$');
      const iterations = parseInt(iterStr, 10);
      const keyLength = 64;
      const digest = 'sha256';

      const computedHash = crypto.pbkdf2Sync(password, salt, iterations, keyLength, digest).toString('hex');
      const computedBuf = Buffer.from(computedHash);
      const storedBuf = Buffer.from(storedHash);

      if (computedBuf.length !== storedBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(computedBuf, storedBuf);
    } else if (hash.startsWith('$2')) {
      // bcrypt format
      return await bcrypt.compare(password, hash);
    } else if (hash.length === 64) {
      // Legacy SHA256 (no salt) - for migration only
      const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(sha256Hash), Buffer.from(hash));
    }
  } catch (err) {
    console.error('Password verification error:', err);
  }
  return false;
}

export function generateSecurePassword(length: number = 16): string {
  return crypto.randomBytes(length).toString('hex');
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Minimum 12 characters required');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Must contain lowercase letters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain uppercase letters');
  }
  if (!/\d/.test(password)) {
    errors.push('Must contain numbers');
  }
  if (!/[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Must contain special characters (!@#$%^&*)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
