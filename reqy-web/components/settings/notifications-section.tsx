"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface NotificationsSectionProps {
  pushEnabled: boolean;
  notifyEvents: Record<string, boolean>;
  systemPushEnabled: boolean;
  systemNotificationPermission: string | undefined;
  onTogglePush: () => void;
  onToggleEvent: (key: string) => void;
  onToggleSystemPush: () => void;
  onRequestSystemPermission: () => void;
  onTestPush: () => void;
}

export default function NotificationsSection({
  pushEnabled,
  notifyEvents,
  systemPushEnabled,
  systemNotificationPermission,
  onTogglePush,
  onToggleEvent,
  onToggleSystemPush,
  onRequestSystemPermission,
  onTestPush,
}: NotificationsSectionProps) {
  const permission = systemNotificationPermission ?? "unavailable";
  const canToggleSystem = permission === "granted";
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="size-5 text-primary" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base">{t("settings.notifications.title")}</CardTitle>
            <CardDescription>{t("settings.notifications.description")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">{t("settings.notifications.enableToasts")}</p>
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.toastsDesc")}
            </p>
          </div>
          <Switch checked={pushEnabled} onCheckedChange={() => onTogglePush()} />
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">{t("settings.notifications.nativeTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.notifications.nativeDesc")}
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
                {t("settings.notifications.permissionLabel")}{" "}
                <span className="font-medium text-foreground">
                  {t("settings.notifications.permissionNotRequested")}
                </span>
                .
              </p>
              <Button size="sm" variant="secondary" onClick={onRequestSystemPermission}>
                {t("settings.notifications.requestPermission")}
              </Button>
            </div>
          )}

          {permission === "denied" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs text-destructive">{t("settings.notifications.blocked")}</p>
            </div>
          )}

          {permission === "granted" && !systemPushEnabled && (
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.grantedNotEnabled")}
            </p>
          )}

          {permission === "granted" && systemPushEnabled && (
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.grantedEnabled")}
            </p>
          )}

          {permission === "unsupported" && (
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.unsupported")}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">{t("settings.notifications.eventsTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            {t("settings.notifications.eventsDesc")}
          </p>
          <div className="mt-3 space-y-2">
            {[
              {
                key: "requestComplete",
                label: t("settings.notifications.events.requestComplete.label"),
                desc: t("settings.notifications.events.requestComplete.desc"),
              },
              {
                key: "collectionComplete",
                label: t("settings.notifications.events.collectionComplete.label"),
                desc: t("settings.notifications.events.collectionComplete.desc"),
              },
              {
                key: "aiResponse",
                label: t("settings.notifications.events.aiResponse.label"),
                desc: t("settings.notifications.events.aiResponse.desc"),
              },
              {
                key: "aiError",
                label: t("settings.notifications.events.aiError.label"),
                desc: t("settings.notifications.events.aiError.desc"),
              },
              {
                key: "importExport",
                label: t("settings.notifications.events.importExport.label"),
                desc: t("settings.notifications.events.importExport.desc"),
              },
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
          <Button variant="secondary" onClick={onTestPush}>
            {t("settings.notifications.testToast")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("settings.notifications.permissionFooter")}{" "}
            <span className="font-medium text-foreground">{permission}</span>
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}
