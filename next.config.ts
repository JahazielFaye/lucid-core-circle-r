import type { NextConfig } from 'next';

const configuredSupabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;
// Realtime starts after sign-in. WebKit enforces WebSocket CSP separately from HTTPS.
const configuredSupabaseSocketOrigin = configuredSupabaseOrigin?.startsWith('https://')
  ? configuredSupabaseOrigin.replace('https://', 'wss://')
  : configuredSupabaseOrigin?.startsWith('http://')
    ? configuredSupabaseOrigin.replace('http://', 'ws://')
    : null;
const connectSources = ["'self'", configuredSupabaseOrigin, configuredSupabaseSocketOrigin].filter(Boolean).join(' ');
// Webpack development bundles use eval; production keeps the existing stricter CSP.
const developmentScriptPolicy = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
const securityHeaders = [
  { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptPolicy}; connect-src ${connectSources}; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:;` },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];
const nextConfig: NextConfig = { async headers() { return [{ source: '/:path*', headers: securityHeaders }]; } };
export default nextConfig;
