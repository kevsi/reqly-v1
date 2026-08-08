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
import { resendCode, verify } from "../api";
import { storeSession } from "./SignInScreen";
import { PALETTE, s } from "../theme";
import type { AuthSession } from "../types";

type Props = {
  baseUrl: string;
  email: string;
  onVerified: (baseUrl: string, session: AuthSession) => void;
  onGoSignIn: () => void;
};

export default function VerifyScreen({ baseUrl, email, onVerified, onGoSignIn }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleVerify() {
    if (code.trim().length !== 6) {
      Alert.alert("Code invalide", "Saisissez le code à 6 chiffres reçu par e-mail.");
      return;
    }
    setBusy(true);
    try {
      const session = await verify(baseUrl, email, code.trim());
      await storeSession(baseUrl, session.token);
      onVerified(baseUrl, session);
    } catch (err) {
      Alert.alert(
        "Vérification impossible",
        err instanceof Error ? err.message : "Erreur inconnue",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    try {
      await resendCode(baseUrl, email);
      Alert.alert("Code renvoyé", "Un nouveau code a été envoyé par e-mail.");
    } catch (err) {
      Alert.alert("Erreur", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
          <Text style={s.title}>Vérification</Text>
          <Text style={s.subtitle}>Saisissez le code à 6 chiffres envoyé à {email}.</Text>

          <View style={s.form}>
            <Text style={s.label}>Code de vérification</Text>
            <TextInput
              style={[s.input, { textAlign: "center", letterSpacing: 8, fontSize: 22 }]}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={PALETTE.muted}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
              onPress={handleVerify}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#0b0f0d" />
              ) : (
                <Text style={s.primaryBtnText}>Vérifier</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.ghostBtn, pressed && s.btnPressed]}
              onPress={handleResend}
            >
              <Text style={s.ghostBtnText}>Renvoyer le code</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.ghostBtn, pressed && s.btnPressed]}
              onPress={onGoSignIn}
            >
              <Text style={[s.ghostBtnText, { color: PALETTE.muted }]}>Retour à la connexion</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
