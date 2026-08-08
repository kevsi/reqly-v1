import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { deleteEvent, replayEvent } from "../api";
import { PALETTE, methodStyle, s } from "../theme";
import type { Endpoint, WebhookEvent } from "../types";

type Props = {
  baseUrl: string;
  token: string;
  events: WebhookEvent[];
  endpoints: Endpoint[];
  onMutated: () => void;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function prettyBody(ev: WebhookEvent): string | null {
  if (!ev.body) return null;
  if (ev.contentType?.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(ev.body), null, 2);
    } catch {
      return ev.body;
    }
  }
  return ev.body;
}

export default function EventsPanel({ baseUrl, token, events, endpoints, onMutated }: Props) {
  const [filter, setFilter] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(events[0]?.id ?? null);

  const endpointName = (id: number) => endpoints.find((e) => e.id === id)?.name ?? `#${id}`;
  const filtered = filter === null ? events : events.filter((e) => e.endpointId === filter);
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null;

  async function handleDelete(ev: WebhookEvent) {
    Alert.alert("Supprimer l'événement", "Supprimer définitivement cet événement ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEvent(baseUrl, token, ev.id);
            onMutated();
          } catch (err) {
            Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
          }
        },
      },
    ]);
  }

  async function handleReplay(ev: WebhookEvent) {
    try {
      await replayEvent(baseUrl, token, ev.id);
      Alert.alert("Rejoué", "L'événement a été rejoué et une notification a été envoyée.");
      onMutated();
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return (
    <ScrollView contentContainerStyle={s.contentList}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 6 }}
      >
        <Pressable
          style={({ pressed }) => [
            s.chip,
            pressed && s.btnPressed,
            filter === null && s.chipActive,
          ]}
          onPress={() => setFilter(null)}
        >
          <Text style={[s.chipText, filter === null && s.chipTextActive]}>Tous</Text>
        </Pressable>
        {endpoints.map((e) => (
          <Pressable
            key={e.id}
            style={({ pressed }) => [
              s.chip,
              pressed && s.btnPressed,
              filter === e.id && s.chipActive,
            ]}
            onPress={() => setFilter(e.id)}
          >
            <Text style={[s.chipText, filter === e.id && s.chipTextActive]}>{e.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {filtered.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>Aucun événement</Text>
          <Text style={s.emptySub}>
            Envoyez une requête vers un de vos endpoints : elle apparaîtra ici instantanément.
          </Text>
        </View>
      ) : (
        filtered.map((ev) => (
          <Pressable
            key={ev.id}
            onPress={() => setSelectedId(ev.id)}
            style={({ pressed }) => [
              s.card,
              pressed && s.btnPressed,
              selected?.id === ev.id && { borderColor: PALETTE.accent },
            ]}
          >
            <View style={s.row}>
              <View style={methodStyle(ev.method)}>
                <Text style={s.methodText}>{ev.method}</Text>
              </View>
              <Text style={[s.cardTitle, { flex: 1 }]} numberOfLines={1}>
                {endpointName(ev.endpointId)}
              </Text>
            </View>
            {ev.replayedFromId ? <Text style={s.replayTag}>↻ rejoué</Text> : null}
            <Text style={s.eventTime}>{formatTime(ev.createdAt)}</Text>
          </Pressable>
        ))
      )}
      {selected ? (
        <View style={s.card}>
          <View style={s.cardRow}>
            <View style={{ flex: 1 }}>
              <View style={s.row}>
                <View style={methodStyle(selected.method)}>
                  <Text style={s.methodText}>{selected.method}</Text>
                </View>
                <Text style={s.cardTitle} numberOfLines={1}>
                  {endpointName(selected.endpointId)}
                </Text>
              </View>
              <Text style={s.cardSub}>
                {formatTime(selected.createdAt)}
                {selected.sourceIp ? ` · ${selected.sourceIp}` : ""}
              </Text>
            </View>
          </View>

          <View style={s.row}>
            <Pressable
              style={({ pressed }) => [s.tinyBtn, pressed && s.btnPressed, styles.actionBtn]}
              onPress={() => handleReplay(selected)}
            >
              <Text style={s.tinyBtnText}>↻ Rejouer</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.tinyBtn, pressed && s.btnPressed, styles.actionBtn]}
              onPress={() => handleDelete(selected)}
            >
              <Text style={[s.tinyBtnText, { color: PALETTE.danger }]}>Suppr.</Text>
            </Pressable>
          </View>

          <Text style={s.label}>Body</Text>
          <View style={s.codeBlock}>
            <Text style={s.monospace}>{prettyBody(selected) ?? "Vide"}</Text>
          </View>

          {selected.query ? (
            <>
              <Text style={s.label}>Query</Text>
              <View style={s.codeBlock}>
                <Text style={s.monospace}>{selected.query}</Text>
              </View>
            </>
          ) : null}

          <Text style={s.label}>Headers</Text>
          <View style={s.codeBlock}>
            {Object.entries(selected.headers).length === 0 ? (
              <Text style={s.monospace}>Aucun en-tête</Text>
            ) : (
              Object.entries(selected.headers).map(([k, v]) => (
                <Text key={k} style={s.monospace}>
                  {k}: {v}
                </Text>
              ))
            )}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = {
  actionBtn: { marginTop: 8 },
};
