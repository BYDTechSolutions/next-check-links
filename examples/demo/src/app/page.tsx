import Link from 'next/link';
import { recentWork } from '../lib/work';

export default function Home() {
  return (
    <main>
      <Link href="/work">All work</Link>
      <Link href="/contcat">Contact</Link>
      {recentWork().map((card) => (
        <Link key={card.href} href={card.href}>
          {card.title}
        </Link>
      ))}
    </main>
  );
}
