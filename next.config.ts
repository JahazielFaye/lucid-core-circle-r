import type { NextConfig } from 'next';

const configuredSupabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : null;
const connectSources = ["'self'", configuredSupabaseOrigin].filter(Boolean).join(' ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src ${connectSources}; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:;` },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];
const nextConfig: NextConfig = { async headers() { return [{ source: '/:path*', headers: securityHeaders }]; } };
export default nextConfig;
