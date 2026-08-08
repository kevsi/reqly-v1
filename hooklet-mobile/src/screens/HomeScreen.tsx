import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import {
  fetchDevices,
  fetchEndpoints,
  fetchEvents,
  registerDevice,
  unregisterDevice,
} from "../api";
import { ensurePushToken } from "../push";
import { clearSession } from "./SignInScreen";
import { s } from "../theme";
import type { Device as DeviceType, Endpoint, User, WebhookEvent } from "../types";
import EventsPanel from "./EventsPanel";
import EndpointsPanel from "./EndpointsPanel";
import DevicesPanel from "./DevicesPanel";

type Props = {
  baseUrl: string;
  token: string;
  user: User;
  onSignOut: () => void;
};

type Tab = "events" | "endpoints" | "devices";

export default function HomeScreen({ baseUrl, token, user, onSignOut }: Props) {
  const [tab, setTab] = useState<Tab>("events");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [devices, setDevices] = useState<DeviceType[]>([]);
  const [pushRegistered, setPushRegistered] = useState(false);
  const pushTokenRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [ep, ev, dv] = await Promise.all([
        fetchEndpoints(baseUrl, token),
        fetchEvents(baseUrl, token),
        fetchDevices(baseUrl, token),
      ]);
      setEndpoints(ep);
      setEvents(ev);
      setDevices(dv);
    } catch (err) {
      Alert.alert("Chargement impossible", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }, [baseUrl, token]);

  const registerPush = useCallback(async () => {
    if (pushRegistered) return;
    try {
      const pushToken = await ensurePushToken();
      if (!pushToken) {
        setPushRegistered(true); // simulator / permission refusée : non bloquant
        return;
      }
      pushTokenRef.current = pushToken;
      const name = Device.deviceName ?? `${Platform.OS} device`;
      await registerDevice(baseUrl, token, pushToken, Platform.OS, name);
      setPushRegistered(true);
    } catch (err) {
      console.warn("push register failed", err);
    }
  }, [baseUrl, token, pushRegistered]);

  useEffect(() => {
    reload();
    registerPush();
    const sub = Notifications.addNotificationReceivedListener(() => reload());
    const resp = Notifications.addNotificationResponseReceivedListener(() => reload());
    return () => {
      sub.remove();
      resp.remove();
    };
  }, [reload, registerPush]);

  async function handleSignOut() {
    try {
      if (pushTokenRef.current) {
        await unregisterDevice(baseUrl, token, pushTokenRef.current).catch(() => undefined);
      }
    } finally {
      await clearSession();
      onSignOut();
    }
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Hooklet</Text>
          <Text style={s.headerSub}>
            {user.email} · {pushRegistered ? "🔔 Notifications actives" : "🔕 Push non enregistré"}
          </Text>
        </View>
        <Pressable onPress={handleSignOut} style={s.signOutBtn}>
          <Text style={s.signOutText}>Déconnexion</Text>
        </Pressable>
      </View>

      <View style={s.tabRow}>
        <Pressable
          style={({ pressed }) => [s.tab, pressed && s.btnPressed, tab === "events" && s.tabActive]}
          onPress={() => setTab("events")}
        >
          <Text style={[s.tabText, tab === "events" && s.tabTextActive]}>Inbox</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            s.tab,
            pressed && s.btnPressed,
            tab === "endpoints" && s.tabActive,
          ]}
          onPress={() => setTab("endpoints")}
        >
          <Text style={[s.tabText, tab === "endpoints" && s.tabTextActive]}>Endpoints</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            s.tab,
            pressed && s.btnPressed,
            tab === "devices" && s.tabActive,
          ]}
          onPress={() => setTab("devices")}
        >
          <Text style={[s.tabText, tab === "devices" && s.tabTextActive]}>Appareils</Text>
        </Pressable>
      </View>

      <View style={s.content}>
        {tab === "events" ? (
          <EventsPanel
            baseUrl={baseUrl}
            token={token}
            events={events}
            endpoints={endpoints}
            onMutated={reload}
          />
        ) : tab === "endpoints" ? (
          <EndpointsPanel
            baseUrl={baseUrl}
            token={token}
            endpoints={endpoints}
            onMutated={reload}
          />
        ) : (
          <DevicesPanel baseUrl={baseUrl} token={token} devices={devices} onMutated={reload} />
        )}
      </View>
    </View>
  );
}
