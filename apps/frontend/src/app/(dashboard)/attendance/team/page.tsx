import { redirect } from 'next/navigation';

export default function TeamAttendanceRedirect() {
  // Carry the intent through. This used to redirect to bare /attendance, which
  // hardcoded the Today tab — so the one thing the deep link asked for was the one
  // thing it could not reach.
  redirect('/attendance?tab=team');
}
