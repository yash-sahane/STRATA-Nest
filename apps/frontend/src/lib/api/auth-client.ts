import { restClient } from './rest-client';
import type { ApiModels } from './types';

interface AuthMeResponse {
  user: ApiModels.User;
  session: ApiModels.Session;
  workspaceIds: string[];
  hasTempPassword: boolean;
  isAdmin: boolean;
}

let cachedUser: ApiModels.User | null = null;
let cachedSession: ApiModels.Session | null = null;

async function loadMe(): Promise<AuthMeResponse> {
  const me = await restClient.get('/api/v1/auth/me/') as AuthMeResponse;
  cachedUser = {
    id: me.user.id,
    email: me.user.email,
    name: me.user.name,
    prefs: {},
    workspaceId: me.user.workspaceId,
    hasTempPassword: me.hasTempPassword,
    isAdmin: me.isAdmin,
    workspaceIds: me.workspaceIds,
    createdAt: me.user.createdAt,
    updatedAt: me.user.updatedAt,
    defaultWorkspaceId: me.user.defaultWorkspaceId,
    role: me.user.role,
    phone: me.user.phone,
    avatar: me.user.avatar,
    status: me.user.status,
  };
  cachedSession = me.session;
  return me;
}

async function getCurrentUser(): Promise<ApiModels.User> {
  if (!cachedUser) await loadMe();
  return cachedUser as ApiModels.User;
}

async function getCurrentSession(): Promise<ApiModels.Session> {
  if (!cachedSession) await loadMe();
  return cachedSession as ApiModels.Session;
}

async function login(email: string, password: string): Promise<ApiModels.Session> {
  const data = await restClient.post('/api/v1/auth/login/', { email, password });
  cachedUser = null;
  cachedSession = null;
  await loadMe();
  return { id: data.sessionId, userId: data.user.id, current: true };
}

async function logout(): Promise<void> {
  try {
    await restClient.post('/api/v1/auth/logout/');
  } finally {
    cachedUser = null;
    cachedSession = null;
  }
}

async function updatePassword(newPassword: string, currentPassword: string): Promise<void> {
  await restClient.post('/api/v1/auth/change-password/', {
    currentPassword,
    newPassword,
  });
  cachedUser = null;
  cachedSession = null;
}

/**
 * Ask for a reset link. The API answers {ok:true} whether or not the address
 * exists — deliberately, so the form cannot be used to enumerate accounts —
 * so callers must show the same confirmation either way.
 */
async function requestPasswordReset(email: string): Promise<void> {
  await restClient.post('/api/v1/auth/password-reset/', { email });
}

/** Complete a reset from the `uid`/`token` pair the emailed link carries. */
async function confirmPasswordReset(
  uid: string,
  token: string,
  newPassword: string,
): Promise<void> {
  await restClient.post('/api/v1/auth/password-reset/confirm/', { uid, token, newPassword });
  // The reset clears hasTempPassword server-side; drop the cached profile so
  // nothing downstream keeps reading the pre-reset one.
  cachedUser = null;
  cachedSession = null;
}

async function updateName(name: string): Promise<ApiModels.User> {
  const user = await restClient.patch('/api/v1/auth/profile/', { name });
  cachedUser = null;
  return user as ApiModels.User;
}

async function updateAvatar(avatar: string): Promise<ApiModels.User> {
  const user = await restClient.patch('/api/v1/auth/profile/', { avatar });
  cachedUser = null;
  return user as ApiModels.User;
}

async function updatePhone(phone: string, _password?: string): Promise<ApiModels.User> {
  const user = await restClient.patch('/api/v1/auth/profile/', { phone });
  cachedUser = null;
  return user as ApiModels.User;
}

export const authClient = {
  getCurrentUser,
  getCurrentSession,
  login,
  logout,
  updatePassword,
  changePassword: (currentPassword: string, newPassword: string) =>
    updatePassword(newPassword, currentPassword),
  requestPasswordReset,
  confirmPasswordReset,
  updateName,
  updatePhone,
  updateAvatar,
};
