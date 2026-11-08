# Build the Android app (APK)

The Android app is the same HomeDesigner 3D, wrapped with Capacitor. You need a computer (Windows, Mac or Linux) once, to build the APK.

1. Install **Node.js (LTS)** from https://nodejs.org and **Android Studio** from https://developer.android.com/studio (let it install the Android SDK).
2. Open a terminal in this project folder, then:
   ```
   npm install
   cd android-app
   npm install
   npm run sync
   npm run open
   ```
   `npm run open` starts Android Studio with the project.
3. In Android Studio wait for Gradle to finish, then choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. When it finishes click **locate**. Copy `app-debug.apk` to your phone, open it and allow "install from this source".

Whenever you change anything in `src/`, run `npm run sync` inside `android-app` and rebuild.

## On the phone
- **Take photo** opens the camera. Put the paper plan flat, in good light, and fill the frame. Turn on "Photo of paper plan" if walls are missed.
- Tap **Menu** to open or close the tool panel. Drag with one finger to turn the view, pinch to zoom, two fingers to pan. Touch a piece of furniture and drag to move it.
- **Walk inside** shows on-screen arrows; drag the picture to look around.
- Your work is saved automatically on the phone.

## Known limits
- Not tested on a real phone or emulator from here (no Android SDK available when this was written). Please report anything that misbehaves.
- **Save picture** and **Save project** open the Android share sheet (choose Drive, Files, WhatsApp, etc.). Not tested on a real phone.
