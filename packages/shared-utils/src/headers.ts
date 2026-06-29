import type { Request } from 'express'; // Type-only import, no runtime dependency needed

/**
 * Safely extract a string header value from an Express request.
 * Express headers can be string, string[], or undefined.
 * This function ensures we always get a string or undefined.
 */
export function getHeaderAsString(req: Request, headerName: string): string | undefined {
  const value = req.headers[headerName];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return undefined;
}

/**
 * Extract user identity headers from Express request.
 * These are set by the auth middleware on all authenticated requests.
 */
export function getUserIdentity(req: Request): {
  userId: string | undefined;
  role: string | undefined;
  email: string | undefined;
} {
  return {
    userId: getHeaderAsString(req, 'x-user-id'),
    role: getHeaderAsString(req, 'x-user-role'),
    email: getHeaderAsString(req, 'x-user-email'),
  };
}

/**
 * Verify that a request has the required user identity headers.
 * Throws an error if any identity header is missing.
 */
export function requireUserIdentity(req: Request): {
  userId: string;
  role: string;
  email: string;
} {
  const { userId, role, email } = getUserIdentity(req);

  if (!userId) {
    throw new Error('Missing x-user-id header. Request must be authenticated.');
  }
  if (!role) {
    throw new Error('Missing x-user-role header. Request must be authenticated.');
  }
  if (!email) {
    throw new Error('Missing x-user-email header. Request must be authenticated.');
  }

  return { userId, role, email };
}
