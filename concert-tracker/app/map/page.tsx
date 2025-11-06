import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import MapClient from './MapClient';

export const metadata = {
  title: 'Concert Map',
  description: 'Interactive map of upcoming concerts with friends',
};

export default async function MapPage() {
  const session = await auth();
  
  if (!session) {
    redirect('/login?callbackUrl=/map');
  }

  return <MapClient />;
}
