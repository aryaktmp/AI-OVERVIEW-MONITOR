import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/ringkasan", destination: "/overview", permanent: true },
      { source: "/keyword", destination: "/keywords", permanent: true },
      { source: "/keyword/:id*", destination: "/keywords/:id*", permanent: true },
      { source: "/kompetitor", destination: "/competitors", permanent: true },
      { source: "/pengaturan", destination: "/settings", permanent: true },
      { source: "/keywords/active", destination: "/keywords?tab=active", permanent: false },
      { source: "/keywords/archived", destination: "/keywords?tab=archived", permanent: false },
      { source: "/keywords/schedule", destination: "/keywords?tab=schedule", permanent: false },
      { source: "/keywords/groups", destination: "/keywords?tab=groups", permanent: false },
    ];
  },
};

export default nextConfig;
