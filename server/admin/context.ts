import type { AdminActionRequest } from './action';
import type { AuthenticatedAdmin } from './session';

/**
 * Future Stage 5 writes go through AdminActionService with this request.
 * A client-supplied adminId is discarded. The session chooses the actor.
 */
export function adminActionFromContext(
  admin: AuthenticatedAdmin,
  request: Omit<AdminActionRequest, 'adminId'> & { adminId?: string },
): AdminActionRequest {
  const { adminId: _clientAdminId, ...rest } = request;
  return { ...rest, adminId: admin.adminId };
}
