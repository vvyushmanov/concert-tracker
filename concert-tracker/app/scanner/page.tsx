import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ScannerClient from './ScannerClient';

export default async function ScannerPage() {
  const session = await auth();
  if (!session) {
    redirect('/login');
  }

  const userId = parseInt(session.user.id);
  const isAdmin = session.user.role === 'ADMIN';

  // Get user settings
  const settings = await prisma.userSetting.findMany({
    where: { userId },
    select: { key: true, value: true }
  });

  const settingsMap = Object.fromEntries(
    settings.map(s => [s.key, s.value])
  );

  // Get active countries
  const activeCountries = await prisma.userActiveCountry.findMany({
    where: { userId },
    include: { country: true }
  });

  const userSettings = {
    minPlaycount: parseInt(settingsMap['MIN_PLAYCOUNT'] || '1'),
    lastfmUser: settingsMap['LASTFM_USER'] || null
  };

  const countryNames = activeCountries.map(ac => ac.country.name).sort();

  return (
    <ScannerClient 
      isAdmin={isAdmin}
      userSettings={userSettings}
      activeCountries={countryNames}
    />
  );
}
