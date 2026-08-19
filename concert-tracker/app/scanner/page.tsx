import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import ScannerClient from './ScannerClient';

export default async function ScannerPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  // Scanning populates the global concert table — an admin maintenance action.
  // Regular users get concerts via read-time personalization (followed artists +
  // active countries), so they have no reason (or permission) to scan.
  if (session.user.role !== 'ADMIN') {
    redirect('/');
  }

  return <ScannerClient />;
}
