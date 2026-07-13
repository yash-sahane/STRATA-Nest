import { redirect } from 'next/navigation';

export default function TeamAttendanceRedirect() {
    // Redirect to main attendance page
    redirect('/attendance');
}
