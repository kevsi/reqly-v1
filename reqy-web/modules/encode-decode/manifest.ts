import type { ModuleManifest } from "@/lib/modules/types";

export const encodeDecodeManifest: ModuleManifest = {
  id: "encode-decode",
  name: "Encodeur / Décodeur",
  version: "0.1.0",
  description:
    "Transformations instantanées et locales : Base64, URL, hexadécimal, JSON, HTML, CSV, décodage JWT, hachage SHA et générateur de valeurs.",
  author: "Reqly",
  kind: "feature",
  nav: [{ label: "Encodeur", href: "/encode-decode/", icon: "Binary" }],
  routes: [{ path: "/encode-decode/", type: "page" }],
  bundled: true,
};
