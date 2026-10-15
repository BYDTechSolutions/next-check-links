/** @type {import('next').NextConfig} */
export default {
  async redirects() {
    return [{ source: '/old-pricing', destination: '/contact', permanent: true }];
  },
};
