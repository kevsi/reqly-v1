import type { ModuleManifest } from "@/lib/modules/types";

export const mockServerManifest: ModuleManifest = {
  id: "mock-server",
  name: "Mock Server",
  description: "Create mock API endpoints for testing and development",
  version: "1.0.0",
  author: "Reqly Team",
  icon: "Server",
  category: "testing",
  nav: [
    {
      label: "Mock Server",
      href: "/mock-server",
      icon: "Server",
    },
  ],
  routes: [
    {
      path: "/mock-server",
      title: "Mock Server",
    },
  ],
  settings: [],
  dependencies: [],
};
