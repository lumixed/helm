# Helm for iPhone and Android

A native Expo app (SDK 58) around the Helm web app, with native notifications.

- The Helm screens run in a native shell with safe areas, pull-to-refresh, swipe-back, a splash screen,
  the Helm icon and a native "Can't reach Helm" screen.
- **Notifications on the phone:** whenever the app opens or comes back to the foreground, it reads the
  person's schedule (`GET /api/mobile/schedule`, through the signed-in page) and schedules native
  notifications on the device: the morning brief, "Helm hands this in shortly" hold notices for
  scheduled hand-ins, and "Due tomorrow" reminders. Tapping one opens the right screen.
- **Server push** (`/api/push/register`, sent by the backend with every Telegram message) is ready
  but needs a development build: Expo Go can't receive server push in SDK 58.
- Links that leave Helm (Gmail sign-in, Telegram) open in the browser.

## Run it on your iPhone (Expo Go, about 5 minutes)

1. Install **Expo Go** from the App Store.
2. On a computer on the same Wi-Fi as the phone:

   ```bash
   cd apps/mobile
   npm install
   npx expo start
   ```

3. Scan the QR code with the iPhone Camera app. Helm opens in Expo Go.
4. Sign in, then allow notifications when asked (after your first page load).

If the phone and computer can't see each other (for example on a campus network), use
`npx expo start --tunnel` instead.

The app points at `extra.helmUrl` in `app.json` (the deployed Helm app).

## Limits

- Local notifications reflect the schedule from the last time the app was opened. A deadline moved by
  email while the app stayed closed is notified the next time it opens (and immediately on Telegram).
- An App Store build needs an Apple developer account and `eas build`; not part of the hackathon build.

## Checks

```bash
npx tsc --noEmit
npx expo export --platform ios   # bundles the app the way the phone runs it
```
