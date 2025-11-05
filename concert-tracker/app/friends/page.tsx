import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import FriendsClient from './FriendsClient';

export default async function FriendsPage() {
  const session = await auth();
  
  if (!session?.user?.id) {
    redirect('/api/auth/signin');
  }
  
  return <FriendsClient />;
}
