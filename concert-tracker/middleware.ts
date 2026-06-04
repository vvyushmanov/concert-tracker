import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Always allow login and auth routes. /api/ingest is the headless scraper-agent
  // endpoint: it is NOT a NextAuth session — it authenticates itself with a
  // constant-time bearer token (INGEST_TOKEN), so it must bypass session gating.
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/ingest'
  ) {
    return NextResponse.next();
  }

  // All other routes require authentication
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes
  const adminRoutes = ['/admin', '/api/settings/global', '/api/settings/audit'];
  const isAdminRoute = adminRoutes.some(route => pathname.startsWith(route));
  
  if (isAdminRoute && session.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
