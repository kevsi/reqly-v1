import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { AuthSession } from "./src/types";
import SignInScreen, {
  clearSession,
  getStoredBaseUrl,
  getStoredToken,
} from "./src/screens/SignInScreen";
import SignUpScreen from "./src/screens/SignUpScreen";
import VerifyScreen from "./src/screens/VerifyScreen";
import HomeScreen from "./src/screens/HomeScreen";
import { getMe } from "./src/api";
import { s } from "./src/theme";

function defaultBaseUrl(): string {
  // Production backend on AWS (shares the same reqly-sync SQLite DB).
  return "https://reqly.duckdns.org";
}

type Session = {
  baseUrl: string;
  session: AuthSession;
};

export default function App() {
  const [booted, setBooted] = useState(false);
  const [route, setRoute] = useState<"signin" | "signup" | "verify" | "home">("signin");
  const [active, setActive] = useState<Session | null>(null);
  const [verifyEmail, setVerifyEmail] = useState("");

  // Restore a stored session on launch.
  useEffect(() => {
    (async () => {
      const [token, baseUrl] = await Promise.all([getStoredToken(), getStoredBaseUrl()]);
      if (token && baseUrl) {
        try {
          const user = await getMe(baseUrl, token);
          setActive({ baseUrl, session: { token, user } });
          setRoute("home");
        } catch {
          // Token expired or server unreachable — require sign-in again.
          await clearSession().catch(() => undefined);
        }
      }
      setBooted(true);
    })();
  }, []);

  if (!booted) {
    return (
      <View style={[s.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color="#34d399" />
      </View>
    );
  }

  if (route === "home" && active) {
    return (
      <View style={s.container}>
        <StatusBar style="light" />
        <HomeScreen
          baseUrl={active.baseUrl}
          token={active.session.token}
          user={active.session.user}
          onSignOut={() => {
            setActive(null);
            setRoute("signin");
          }}
        />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      {route === "signin" ? (
        <SignInScreen
          initialBaseUrl={defaultBaseUrl()}
          onSignedIn={(baseUrl, session) => {
            setActive({ baseUrl, session });
            setRoute("home");
          }}
          onGoSignUp={() => setRoute("signup")}
          onNeedsVerification={(email) => {
            setVerifyEmail(email);
            setRoute("verify");
          }}
        />
      ) : route === "signup" ? (
        <SignUpScreen
          baseUrl={defaultBaseUrl()}
          onGoSignIn={() => setRoute("signin")}
          onSignedUp={(email) => {
            setVerifyEmail(email);
            setRoute("verify");
          }}
        />
      ) : (
        <VerifyScreen
          baseUrl={defaultBaseUrl()}
          email={verifyEmail}
          onVerified={(baseUrl, session) => {
            setActive({ baseUrl, session });
            setRoute("home");
          }}
          onGoSignIn={() => setRoute("signin")}
        />
      )}
    </View>
  );
}
