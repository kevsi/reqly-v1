import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { signin } from "../api";
import { PALETTE, s } from "../theme";
import type { AuthSession } from "../types";

const TOKEN_KEY = "hooklet_session_token";
const BASE_URL_KEY = "hooklet_base_url";

export async function getStoredToken(): Promise<string | null> {
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function getStoredBaseUrl(): Promise<string | null> {
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(BASE_URL_KEY);
}
export async function storeSession(baseUrl: string, token: string) {
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(BASE_URL_KEY, baseUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearSession() {
  const SecureStore = await import("expo-secure-store");
  await SecureStore.deleteItemAsync(BASE_URL_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

type Props = {
  initialBaseUrl: string;
  onSignedIn: (baseUrl: string, session: AuthSession) => void;
  onGoSignUp: () => void;
  onNeedsVerification: (email: string) => void;
};

export default function SignInScreen({
  initialBaseUrl,
  onSignedIn,
  onGoSignUp,
  onNeedsVerification,
}: Props) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    if (!baseUrl.trim()) {
      Alert.alert("Champ requis", "Saisissez l'URL du serveur.");
      return;
    }
    if (!email.trim() || !password) {
      Alert.alert("Champs requis", "Saisissez votre e-mail et votre mot de passe.");
      return;
    }
    setBusy(true);
    try {
      const session = await signin(baseUrl.trim(), email.trim(), password);
      await storeSession(baseUrl.trim(), session.token);
      onSignedIn(baseUrl.trim(), session);
    } catch (err) {
      const e = err as Error & { needsVerification?: boolean };
      if (e.needsVerification) {
        onNeedsVerification(email.trim());
      } else {
        Alert.alert("Connexion impossible", e.message || "Erreur inconnue");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
          <View style={[s.logoBadge, { alignSelf: "center" }]}>
            <Text style={s.logoGlyph}>⚡</Text>
          </View>
          <Text style={s.title}>Hooklet</Text>
          <Text style={s.subtitle}>
            Vos webhooks, dans votre poche. Connectez-vous pour gérer vos endpoints et recevoir vos
            notifications.
          </Text>

          <View style={s.form}>
            <Text style={s.label}>URL du serveur</Text>
            <TextInput
              style={s.input}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://votre-serveur.example.com"
              placeholderTextColor={PALETTE.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={s.label}>E-mail</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="vous@exemple.com"
              placeholderTextColor={PALETTE.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={s.label}>Mot de passe</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={PALETTE.muted}
              secureTextEntry
            />
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
              onPress={handleSignIn}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#0b0f0d" />
              ) : (
                <Text style={s.primaryBtnText}>Se connecter</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.ghostBtn, pressed && s.btnPressed]}
              onPress={onGoSignUp}
            >
              <Text style={s.ghostBtnText}>Créer un compte</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
