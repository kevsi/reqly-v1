"use client"

import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface NotificationsSectionProps {
  pushEnabled: boolean
  notifyEvents: Record<string, boolean>
  systemPushEnabled: boolean
  systemNotificationPermission: string | undefined
  onTogglePush: () => void
  onToggleEvent: (key: string) => void
  onToggleSystemPush: () => void
  onRequestSystemPermission: () => void
  onTestPush: () => void
}

export default function NotificationsSection({
  pushEnabled, notifyEvents, systemPushEnabled,
  systemNotificationPermission,
  onTogglePush, onToggleEvent, onToggleSystemPush, onRequestSystemPermission,
  onTestPush,
}: NotificationsSectionProps) {
  const permission = systemNotificationPermission ?? "unavailable"
  const canToggleSystem = permission === "granted"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="size-5 text-primary" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base">Notifications</CardTitle>
            <CardDescription>Gérez les toasts dans l'interface et les notifications natives du navigateur.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Activer les notifications (toasts)</p>
            <p className="text-xs text-muted-foreground">Les notifications apparaîtront sous forme de toasts dans l'interface.</p>
          </div>
          <Switch checked={pushEnabled} onCheckedChange={() => onTogglePush()} />
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Notifications natives du navigateur</p>
              <p className="text-xs text-muted-foreground">
                Reçoit une notification OS quand un événement important se produit et que vous n'êtes pas sur l'onglet.
              </p>
            </div>
            <Switch
              checked={systemPushEnabled && canToggleSystem}
              disabled={!canToggleSystem}
              onCheckedChange={() => onToggleSystemPush()}
            />
          </div>

          {permission === "default" && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">
                Permission du navigateur : <span className="font-medium text-foreground">non demandée</span>.
              </p>
              <Button size="sm" variant="secondary" onClick={onRequestSystemPermission}>
                Demander la permission
              </Button>
            </div>
          )}

          {permission === "denied" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-destructive">
                Notifications bloquées par le navigateur. Réactivez-les via l'icône cadenas à gauche de l'URL (Notifications → Autoriser), puis rechargez la page.
              </p>
            </div>
          )}

          {permission === "granted" && !systemPushEnabled && (
            <p className="text-xs text-muted-foreground">
              Permission accordée — activez le toggle ci-dessus pour recevoir des notifications natives.
            </p>
          )}

          {permission === "granted" && systemPushEnabled && (
            <p className="text-xs text-muted-foreground">
              Permission accordée. Les notifications natives sont actives pour les événements cochés ci-dessous.
            </p>
          )}

          {permission === "unsupported" && (
            <p className="text-xs text-muted-foreground">
              Votre navigateur ne supporte pas les notifications natives.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Événements notifiés</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Cochez les événements pour lesquels vous voulez être notifié (toast + notification native). Décochez pour les masquer complètement.
          </p>
          <div className="mt-3 space-y-2">
            {[
              { key: 'requestComplete', label: 'Requête terminée', desc: 'Notification quand une requête se termine.' },
              { key: 'collectionComplete', label: 'Exécution de collection terminée', desc: "Notification à la fin d'une exécution de collection (surtout utile en background)." },
              { key: 'aiResponse', label: 'Réponse IA reçue', desc: "Notification quand l'assistant IA renvoie une réponse." },
              { key: 'aiError', label: 'Erreur IA', desc: 'Notification pour les erreurs renvoyées par le proxy IA.' },
              { key: 'importExport', label: 'Import / Export terminé', desc: "Notification après import/export des collections." },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Checkbox checked={notifyEvents[key]} onCheckedChange={() => onToggleEvent(key)} />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t pt-5">
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onTestPush}>Tester un toast</Button>
          <span className="text-sm text-muted-foreground">
            Permission navigateur : <span className="font-medium text-foreground">{permission}</span>
          </span>
        </div>
      </CardFooter>
    </Card>
  )
}
