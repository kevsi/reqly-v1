import { ModuleRouteGate } from "@/components/modules/module-route-gate";
import { EncodeDecodePage } from "@/modules/encode-decode/page";

export default function EncodeDecodeRoute() {
  return (
    <ModuleRouteGate moduleId="encode-decode">
      <EncodeDecodePage />
    </ModuleRouteGate>
  );
}
