import { restClient } from './rest-client';
import type { ApiModels } from './types';
import { setServerTimeZone } from '@/lib/utils/working-days';

interface AuthMeResponse {
  user: ApiModels.User;
  session: ApiModels.Session;
  workspaceIds: string[];
  hasTempPassword: boolean;
  isAdmin: boolean;
  /** The IANA zone the server files attendance days in. Optional: an older API omits it,
   *  and the date helpers fall back to the browser's own date when it is absent. */
  businessTimezone?: string;
  /** Whether mail from this installation reaches an inbox. Absent from an older API. */
  mailDelivers?: boolean;
}

let cachedUser: ApiModels.User | null = null;
let cachedSession: ApiModels.Session | null = null;

async function loadMe(): Promise<AuthMeResponse> {
  const me = await restClient.get('/api/v1/auth/me/') as AuthMeResponse;
  // Before anything reads a date: the calendar, the attendance rate and the leave forms
  // all ask `todayDateOnly()` which day it is, and it answered with the BROWSER's date
  // while the server filed rows against its own. A member outside the server's timezone
  // saw their check-in land on a day their calendar called tomorrow.
  setServerTimeZone(me.businessTimezone);
  cachedUser = {
    id: me.user.id,
    email: me.user.email,
    name: me.user.name,
    prefs: {},
    workspaceId: me.user.workspaceId,
    hasTempPassword: me.hasTempPassword,
    isAdmin: me.isAdmin,
    mailDelivers: me.mailDelivers !== false,
    workspaceIds: me.workspaceIds,
    createdAt: me.user.createdAt,
    updatedAt: me.user.updatedAt,
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
  const data = await restClient.post<{ sessionId: string; user: { id: string } }>(
    '/api/v1/auth/login/',
    { email, password },
  );
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

/**
 * Drop the cached profile — another tab signed this browser out. `getCurrentUser`
 * answers from the cache once it holds one, so without this the tab would go on
 * reporting the last user as signed in.
 */
function forget(): void {
  cachedUser = null;
  cachedSession = null;
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
async function requestPasswordReset(email: string): Promise<{ delivers: boolean }> {
  const answer = (await restClient.post('/api/v1/auth/password-reset/', { email })) as
    | { delivers?: boolean }
    | undefined;
  // `delivers` is about the installation — whether it can send mail at all —
  // and is the same for every address. Absent (an older API), assume it can.
  return { delivers: answer?.delivers !== false };
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
  forget,
  updatePassword,
  requestPasswordReset,
  confirmPasswordReset,
  updateName,
  updatePhone,
  updateAvatar,
};
