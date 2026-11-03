import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { pushPlatform, Registered, shouldAsk } from './push-rules';

// While the app is open, CROP's messages still show as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const registered = new Registered();

/**
 * After sign-in: asks once for permission, gets this phone's Expo push token and tells CROP, for this business.
 * Never gets in the way: no permission, a simulator, or a build without push set up just means no push.
 */
export async function registerForPush(tenant: string): Promise<void> {
  const platform = pushPlatform(Platform.OS);
  if (!platform) return;
  try {
    if (platform === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'CROP', importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && shouldAsk(perm.status, perm.canAskAgain)) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (registered.has(tenant, token)) return;
    await api('/push-devices', { method: 'POST', tenant, body: { token, platform } });
    registered.set(tenant, token);
  } catch {
    // No push on this phone for now; everything else works as before.
  }
}

/** At sign-out: CROP stops sending to this phone. */
export async function forgetPush(): Promise<void> {
  for (const [tenant, token] of registered.take()) {
    await api('/push-devices/remove', { method: 'POST', tenant, body: { token } }).catch(() => undefined);
  }
}
