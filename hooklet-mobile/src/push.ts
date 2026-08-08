import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";

// Show push notifications as banners while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Acquire an Expo push token, requesting permission and setting up the Android
 * notification channel as needed. Returns null on simulator or if permission is
 * refused.
 */
export async function ensurePushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    // Expo Go on a simulator cannot receive push notifications.
    return null;
  }
  const status = await Notifications.getPermissionsAsync();
  let granted = status.granted;
  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Webhooks",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}
