import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import UsersManagement from './UsersManagement';

export default async function AdminUsersPage() {
  const session = await auth();
  
  if (!session) {
    redirect('/login?callbackUrl=/admin/users');
  }

  if (session.user.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <div className="p-8 bg-gray-50 dark:bg-gray-900" style={{ minHeight: 'calc(100vh - 3rem)' }}>
      <main className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">User Management</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Create and manage user accounts
          </p>
        </div>

        <UsersManagement />
      </main>
    </div>
  );
}
