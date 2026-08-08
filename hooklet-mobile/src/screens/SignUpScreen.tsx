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
import { signup } from "../api";
import { PALETTE, s } from "../theme";

type Props = {
  baseUrl: string;
  onGoSignIn: () => void;
  onSignedUp: (email: string) => void;
};

export default function SignUpScreen({ baseUrl, onGoSignIn, onSignedUp }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSignUp() {
    if (!email.trim() || !password) {
      Alert.alert("Champs requis", "Saisissez votre e-mail et votre mot de passe.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Mot de passe trop court", "Le mot de passe doit faire au moins 8 caractères.");
      return;
    }
    setBusy(true);
    try {
      await signup(baseUrl, email.trim(), password, name.trim() || undefined);
      onSignedUp(email.trim());
    } catch (err) {
      Alert.alert("Inscription impossible", err instanceof Error ? err.message : "Erreur inconnue");
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
          <Text style={s.title}>Créer un compte</Text>
          <Text style={s.subtitle}>
            Un code de vérification vous sera envoyé par e-mail pour finaliser l&apos;inscription.
          </Text>

          <View style={s.form}>
            <Text style={s.label}>Nom (optionnel)</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Votre nom"
              placeholderTextColor={PALETTE.muted}
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
              placeholder="8 caractères minimum"
              placeholderTextColor={PALETTE.muted}
              secureTextEntry
            />
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
              onPress={handleSignUp}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#0b0f0d" />
              ) : (
                <Text style={s.primaryBtnText}>S&apos;inscrire</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.ghostBtn, pressed && s.btnPressed]}
              onPress={onGoSignIn}
            >
              <Text style={s.ghostBtnText}>Déjà un compte ? Se connecter</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
