"use client";

import { CallbackSimulator } from "@/modules/mobile-money/callback-simulator";
import { TunnelFacilitator } from "@/components/tunnel-facilitator";

export default function MobileMoneyPage() {
  return (
    <main className="flex-1 overflow-auto p-6" data-testid="mobile-money-page">
      <h1 className="mb-1 text-xl font-semibold text-foreground">
        Simulateur de callback Mobile Money
      </h1>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Générez et envoyez un payload de callback simulé (template) vers l&apos;URL de votre choix
        pour tester la réception côté provider. Associez-le à un tunnel gratuit (Cloudflare Tunnel /
        ngrok) pour recevoir un vrai callback.
      </p>
      <CallbackSimulator />
      <TunnelFacilitator />
    </main>
  );
}
