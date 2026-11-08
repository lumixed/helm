import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import {
  type ComponentProps,
  type ComponentType,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView as RNWebView, type WebViewMessageEvent } from 'react-native-webview';

/**
 * react-native-webview 14 types WebView as a function component without a ref, but at runtime
 * it exposes these methods through one. Declare exactly what this app uses.
 */
interface WebViewHandle {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}
const WebView = RNWebView as unknown as ComponentType<
  ComponentProps<typeof RNWebView> & { ref?: Ref<WebViewHandle> }
>;

/**
 * Helm for iPhone/Android: a native shell around the Helm app, with native notifications.
 *
 * Notifications: Expo Go can't receive server push (SDK 58), but it can show local notifications.
 * So whenever the app opens or comes back to the foreground, it asks the signed-in page for the
 * person's schedule (/api/mobile/schedule) and schedules the brief, hold notices and "due
 * tomorrow" reminders on the phone. In a development build it also registers for server push.
 */
const BASE: string =
  (Constants.expoConfig?.extra?.helmUrl as string | undefined) ?? 'https://helm-pi-fawn.vercel.app';
const ORIGIN = new URL(BASE).origin;
const CANVAS = '#f4f5f7';
const INK = '#0b1220';
const isExpoGo = Constants.executionEnvironment === 'storeClient';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface LocalNotification {
  id: string;
  at: string;
  title: string;
  body: string;
  path: string;
}

/** Runs inside the signed-in page (same origin, so the session cookie applies). */
function syncScript(pushToken: string | null): string {
  const register = pushToken
    ? `await fetch('/api/push/register', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ${JSON.stringify(pushToken)}, platform: ${JSON.stringify(Platform.OS)} }) });`
    : '';
  return `(async function () {
    try {
      const r = await fetch('/api/mobile/schedule', { credentials: 'include', cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'schedule', ok: r.ok, notifications: d ? d.notifications : [] }));
      if (r.ok) { ${register} }
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'schedule', ok: false }));
    }
  })(); true;`;
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Server push needs a development build; in Expo Go this returns null. */
async function pushToken(): Promise<string | null> {
  if (isExpoGo || !Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

/** Replace everything Helm scheduled with the latest list (idempotent). */
async function scheduleAll(list: LocalNotification[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  for (const n of list) {
    const date = new Date(n.at);
    if (Number.isNaN(date.getTime()) || date.getTime() <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: n.id,
      content: { title: n.title, body: n.body, data: { path: n.path }, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  }
}

const pathFrom = (r: Notifications.NotificationResponse | null) => {
  const p = r?.notification.request.content.data?.path;
  return typeof p === 'string' && p.startsWith('/') ? p : null;
};

export default function App() {
  const web = useRef<WebViewHandle>(null);
  const loaded = useRef(false);
  const lastSync = useRef(0);
  const lastSchedule = useRef('');
  const token = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Open the screen a notification points to, including when it launched the app.
  const [uri] = useState(
    () => `${BASE}${pathFrom(Notifications.getLastNotificationResponse()) ?? '/today'}`,
  );

  const sync = useCallback((force = false) => {
    if (!loaded.current || !web.current) return;
    if (!force && Date.now() - lastSync.current < 30_000) return;
    lastSync.current = Date.now();
    web.current.injectJavaScript(syncScript(token.current));
  }, []);

  useEffect(() => {
    pushToken().then((t) => (token.current = t));
    Notifications.clearLastNotificationResponse();
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const path = pathFrom(r);
      if (path) web.current?.injectJavaScript(`location.assign(${JSON.stringify(path)}); true;`);
    });
    const app = AppState.addEventListener('change', (s) => s === 'active' && sync());
    const splash = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 4000);
    return () => {
      tap.remove();
      app.remove();
      clearTimeout(splash);
    };
  }, [sync]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; ok?: boolean; notifications?: LocalNotification[] };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    // Not signed in yet (401): nothing to schedule; try again after the next page load.
    if (msg.type !== 'schedule' || !msg.ok || !Array.isArray(msg.notifications)) return;
    const key = JSON.stringify(msg.notifications);
    if (key === lastSchedule.current) return;
    if (!(await ensurePermission())) return;
    await scheduleAll(msg.notifications);
    lastSchedule.current = key;
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.root} edges={['top']}>
        {failed ? (
          <View style={styles.offline} accessibilityRole="alert">
            <Text style={styles.title}>Can&apos;t reach Helm</Text>
            <Text style={styles.body}>
              Check your connection, then try again. Your agent keeps working in the meantime.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
              onPress={() => {
                setFailed(false);
                web.current?.reload();
              }}
            >
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        <WebView
          ref={web}
          source={{ uri }}
          style={[styles.web, failed && styles.hidden]}
          applicationNameForUserAgent="HelmApp/1.0"
          sharedCookiesEnabled
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          contentInsetAdjustmentBehavior="never"
          decelerationRate="normal"
          setSupportMultipleWindows={false}
          onMessage={onMessage}
          onLoadEnd={() => {
            loaded.current = true;
            SplashScreen.hideAsync().catch(() => undefined);
            sync(true);
          }}
          onError={() => setFailed(true)}
          // Keep Helm inside the app; open anything else (Gmail sign-in, Telegram, links) in the browser.
          onShouldStartLoadWithRequest={(req) => {
            if (
              req.url.startsWith(ORIGIN) ||
              req.url.startsWith('about:') ||
              req.url.startsWith('blob:')
            )
              return true;
            Linking.openURL(req.url).catch(() => undefined);
            return false;
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CANVAS },
  web: { flex: 1, backgroundColor: CANVAS },
  hidden: { display: 'none' },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 28, color: INK, fontWeight: '400', letterSpacing: -0.4 },
  body: { fontSize: 16, color: '#646b78', textAlign: 'center', lineHeight: 22 },
  button: {
    marginTop: 8,
    backgroundColor: INK,
    borderRadius: 999,
    paddingHorizontal: 24,
    height: 44,
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
