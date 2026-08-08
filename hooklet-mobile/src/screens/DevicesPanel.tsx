import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { sendTestPush, unregisterDevice } from "../api";
import { PALETTE, s } from "../theme";
import type { Device } from "../types";

type Props = {
  baseUrl: string;
  token: string;
  devices: Device[];
  onMutated: () => void;
};

export default function DevicesPanel({ baseUrl, token, devices, onMutated }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleRemove(d: Device) {
    try {
      await unregisterDevice(baseUrl, token, d.expoPushToken);
      onMutated();
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  async function handleTestPush() {
    setBusy(true);
    try {
      const { count } = await sendTestPush(baseUrl, token);
      Alert.alert(
        "Test envoyé",
        count > 0 ? `Notification envoyée à ${count} appareil(s).` : "Aucun appareil à notifier.",
      );
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.contentList}>
      <View style={s.card}>
        <Text style={s.cardTitle}>Appareils enregistrés</Text>
        <Text style={s.cardSub}>Téléphones qui reçoivent les notifications push.</Text>
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
          onPress={handleTestPush}
          disabled={busy || devices.length === 0}
        >
          {busy ? (
            <ActivityIndicator color="#0b0f0d" />
          ) : (
            <Text style={s.primaryBtnText}>Envoyer un test push</Text>
          )}
        </Pressable>
      </View>

      {devices.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Aucun appareil</Text>
          <Text style={s.emptySub}>
            Ce téléphone s&apos;enregistre automatiquement au premier lancement après connexion.
          </Text>
        </View>
      ) : (
        devices.map((d) => (
          <View key={d.id} style={[s.card, s.cardRow]}>
            <View style={{ flex: 1 }}>
              <View style={s.row}>
                <Text style={[s.cardTitle, { flex: 1 }]}>{d.deviceName ?? "Appareil"}</Text>
                {d.platform ? (
                  <Text style={[s.tinyBtnText, { color: PALETTE.accent }]}>{d.platform}</Text>
                ) : null}
              </View>
              <Text style={[s.monospace, { marginTop: 4 }]} numberOfLines={1}>
                {d.expoPushToken}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [s.tinyBtn, pressed && s.btnPressed]}
              onPress={() => handleRemove(d)}
            >
              <Text style={[s.tinyBtnText, { color: PALETTE.danger }]}>Retirer</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
