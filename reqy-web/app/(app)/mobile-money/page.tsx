"use client";

import { ModuleRouteGate } from "@/components/modules/module-route-gate";
import MobileMoneyPage from "@/modules/mobile-money/page";

export default function Page() {
  return (
    <ModuleRouteGate moduleId="mtn-momo">
      <MobileMoneyPage />
    </ModuleRouteGate>
  );
}
