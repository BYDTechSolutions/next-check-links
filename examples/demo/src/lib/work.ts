// Nothing is published yet, so no card renders and no built page holds this link.
const published: { slug: string; title: string }[] = [];

export function recentWork() {
  return published.map(({ slug, title }) => ({ title, href: `/work/${slug}` }));
}
