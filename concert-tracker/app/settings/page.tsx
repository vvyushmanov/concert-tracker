import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const session = await auth();
  
  if (!session) {
    redirect('/login?callbackUrl=/settings');
  }

  const isAdmin = session.user.role === 'ADMIN';
  const userId = session.user.id;

  return <SettingsClient isAdmin={isAdmin} userId={userId} />;
}
