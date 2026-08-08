import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { createEndpoint, deleteEndpoint, endpointUrl, toggleNotify } from "../api";
import { PALETTE, s } from "../theme";
import type { Endpoint } from "../types";

type Props = {
  baseUrl: string;
  token: string;
  endpoints: Endpoint[];
  onMutated: () => void;
};

async function copy(text: string) {
  // Built-in share sheet (no extra dependency) — Copy is offered on Android/iOS.
  await Share.share({ message: text });
}

export default function EndpointsPanel({ baseUrl, token, endpoints, onMutated }: Props) {
  const [name, setName] = useState("");
  const [withSecret, setWithSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      await createEndpoint(baseUrl, token, name.trim() || "New endpoint", withSecret);
      setName("");
      setWithSecret(false);
      onMutated();
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(ep: Endpoint, next: boolean) {
    try {
      await toggleNotify(baseUrl, token, ep.id, next);
      onMutated();
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  function handleDelete(ep: Endpoint) {
    Alert.alert("Supprimer l'endpoint", `Supprimer « ${ep.name} » et ses événements ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEndpoint(baseUrl, token, ep.id);
            onMutated();
          } catch (err) {
            Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={s.contentList} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.cardTitle}>Créer un endpoint</Text>
        <Text style={s.cardSub}>
          Chaque endpoint reçoit une URL unique. Pointez un service dessus : chaque requête arrive
          dans votre boîte et sonne sur votre téléphone.
        </Text>
        <Text style={s.label}>Nom</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="Paiements Stripe"
          placeholderTextColor={PALETTE.muted}
        />
        <View style={[s.row, { justifyContent: "space-between", marginTop: 12 }]}>
          <Text style={[s.cardSub, { marginTop: 0 }]}>Exiger un secret</Text>
          <Switch
            value={withSecret}
            onValueChange={setWithSecret}
            trackColor={{ false: PALETTE.border, true: PALETTE.accent }}
          />
        </View>
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
          onPress={handleCreate}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#0b0f0d" />
          ) : (
            <Text style={s.primaryBtnText}>Créer</Text>
          )}
        </Pressable>
      </View>

      {endpoints.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Aucun endpoint</Text>
          <Text style={s.emptySub}>
            Créez-en un ci-dessus pour obtenir votre première URL de webhook.
          </Text>
        </View>
      ) : (
        endpoints.map((ep) => (
          <View key={ep.id} style={s.card}>
            <View style={s.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{ep.name}</Text>
                {ep.secret ? (
                  <Text style={[s.cardSub, { color: PALETTE.accent }]}>🔒 Sécurisé</Text>
                ) : null}
                <Text style={[s.monospace, { marginTop: 6 }]} numberOfLines={1}>
                  {endpointUrl(baseUrl, ep.slug)}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [s.tinyBtn, pressed && s.btnPressed]}
                onPress={() => copy(endpointUrl(baseUrl, ep.slug))}
              >
                <Text style={s.tinyBtnText}>Copier</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.tinyBtn, pressed && s.btnPressed]}
                onPress={() => handleDelete(ep)}
              >
                <Text style={[s.tinyBtnText, { color: PALETTE.danger }]}>Suppr.</Text>
              </Pressable>
            </View>

            {ep.secret ? (
              <View style={{ marginTop: 10 }}>
                <Text style={s.label}>Secret</Text>
                <View style={s.codeBlock}>
                  <Text style={s.monospace} numberOfLines={1}>
                    {ep.secret}
                  </Text>
                </View>
                <Text style={s.cardSub}>Envoyez-le dans l&apos;en-tête x-webhook-secret.</Text>
                <Pressable
                  style={({ pressed }) => [
                    s.tinyBtn,
                    pressed && s.btnPressed,
                    { alignSelf: "flex-start", marginTop: 8 },
                  ]}
                  onPress={() => copy(ep.secret as string)}
                >
                  <Text style={s.tinyBtnText}>Copier le secret</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={[s.row, { justifyContent: "space-between", marginTop: 12 }]}>
              <Text style={[s.cardSub, { marginTop: 0 }]}>Notifications push</Text>
              <Switch
                value={ep.notify}
                onValueChange={(next) => handleToggle(ep, next)}
                trackColor={{ false: PALETTE.border, true: PALETTE.accent }}
              />
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
