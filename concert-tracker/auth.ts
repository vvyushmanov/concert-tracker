import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }
        
        const user = await prisma.user.findUnique({ 
          where: { username: credentials.username as string } 
        });
        
        if (!user) {
          return null;
        }
        
        const valid = await bcrypt.compare(
          credentials.password as string, 
          user.hashedPassword
        );
        
        if (!valid) {
          return null;
        }
        
        return {
          id: user.id.toString(),
          name: user.username,
          role: user.role,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  },
  events: {
    async signIn({ user }) {
      // Optional: log successful logins
      console.log(`User ${user.name} signed in`);
    },
  },
  logger: {
    error(code, ...message) {
      // Suppress CredentialsSignin errors in development (expected for invalid login attempts)
      if (code.name === 'CredentialsSignin') {
        console.log('Failed login attempt');
      } else {
        console.error(code, ...message);
      }
    },
    warn(code) {
      console.warn(code);
    },
    debug(code, ...message) {
      // Suppress debug logs in production
      if (process.env.NODE_ENV === 'development') {
        console.log(code, ...message);
      }
    },
  },
});
