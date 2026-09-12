export type ApiResponse<T = any> = {
  success: boolean;
  code: string;
  message: string;
  time: string;
  data: T | null;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
  error?: string;
};

export function successResponse<T>(
  data: T,
  message: string = 'Success',
  pagination?: ApiResponse['pagination']
): ApiResponse<T> {
  return {
    success: true,
    code: 'SUCCESS',
    message,
    time: new Date().toISOString(),
    data,
    pagination
  };
}

export function errorResponse(
  code: string,
  message: string,
  statusCode: number = 400
): { response: ApiResponse; status: number } {
  return {
    response: {
      success: false,
      code,
      message,
      time: new Date().toISOString(),
      data: null,
      error: message
    },
    status: statusCode
  };
}

// Common error codes
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  SQL_ERROR: 'SQL_ERROR'
} as const;
