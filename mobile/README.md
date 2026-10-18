# TaskM phone app

A Capacitor shell that loads https://taskm-school.web.app, so the app always runs the latest website with no app update.
The website notices it's inside the app (`window.Capacitor`) and switches on the phone-only parts:

- **Google sign-in** uses the phone's own Google sign-in (`@capacitor-firebase/authentication`), because Google blocks its sign-in page inside apps. See `googleIn()` in accounts.js.
- **Reminders** (`@capacitor/local-notifications`) arrive even when TaskM is closed: 7 PM the evening before each test, quiz or project, plus one 7 PM note for other homework due the next day. They're rebuilt whenever the list or a checkmark changes. See `remindPlan()` in connect.js.
- `www/offline.html` shows when the phone has no internet.
- **School pages** (`ios/App/App/SchoolPage.swift`, the phone version of the TaskM Chrome button): TaskM's setup steps open OneNote, Teams, Aeries or Outlook in TaskM's own browser. The student signs in on that site's page and taps **Add to TaskM**, and the page's text goes to TaskM like a page from the Chrome button. Sign-ins stay on the phone, so pages added on the phone are read again in a hidden reader when TaskM opens (once their last read is 20+ hours old). See `schoolOpen()` and `phoneRefresh()` in connect.js. Android doesn't have this yet, so it keeps the Chrome-button steps.

Not on the App Store. For now it runs only on Jeremy's own iPhone, installed from his Mac.

## Run it on your iPhone (free, from a Mac)

One-time setup:
1. Install **Xcode** from the Mac App Store, open it once, and let it install its extra parts.
2. Firebase is already set up: the iOS app `app.taskm.school` is registered, and its `GoogleService-Info.plist` plus the Google sign-in URL scheme are in the Xcode project.
3. Get the code onto the Mac, then build it:
   ```
   cd school-share/mobile
   npm install
   npx cap sync ios
   npx cap open ios
   ```
4. Click **App** at the top of the left sidebar, open Signing & Capabilities, tick "Automatically manage signing", and pick your Apple ID as the Team (Xcode > Settings > Accounts adds it).
5. Plug in your iPhone, unlock it, and pick it at the top of Xcode. Then press ▶︎ (Run).
6. The first time, on the iPhone go to Settings > General > VPN & Device Management, tap your Apple ID, and choose Trust. Settings > Privacy & Security > Developer Mode must be on too.

With a free Apple ID, the app stops opening after 7 days. Press ▶︎ in Xcode again to renew it.

Website changes show up in the app by themselves. When something in `mobile/` changes, get the new code (`git pull`), run `npx cap sync ios`, then press ▶︎ again.

## Android (later)

`npx cap sync android && npx cap open android` opens Android Studio. Google sign-in needs `google-services.json` from Firebase in `android/app/`, plus the debug SHA-1 fingerprint added in Firebase.
