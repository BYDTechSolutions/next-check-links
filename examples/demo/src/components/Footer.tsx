'use client';
import { useRouter } from 'next/navigation';

export function Footer() {
  const router = useRouter();
  return (
    <footer>
      <a href="/brand/logo.svg">Logo</a>
      <button onClick={() => router.push('/old-pricing')}>Pricing</button>
      <a href="mailto:hello@example.com">Email</a>
    </footer>
  );
}
