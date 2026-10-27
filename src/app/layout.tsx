import './globals.css';
import './weigh-mode.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lucid Core — Circle R',
  description: 'Unified operations and integration hub for Circle R Beef',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
