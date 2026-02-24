import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that require authentication
const protectedPrefixes = ['/feed', '/leaderboard', '/profile', '/admin', '/markets'];
// Routes only for unauthenticated users
const authRoutes = ['/login', '/verify'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — MUST be called before getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Fast path: unauthenticated users — no need to check ban status
  if (!user) {
    if (protectedPrefixes.some((p) => pathname.startsWith(p))) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Authenticated: redirect auth pages → feed immediately (no ban check needed)
  if (authRoutes.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = '/feed';
    return NextResponse.redirect(url);
  }

  // Authenticated: redirect root → feed immediately
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/feed';
    return NextResponse.redirect(url);
  }

  // Check if banned user is trying to access protected pages
  if (pathname !== '/banned') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_banned')
      .eq('id', user.id)
      .single();

    if (profile?.is_banned) {
      // Sign them out and redirect to banned page
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = '/banned';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
