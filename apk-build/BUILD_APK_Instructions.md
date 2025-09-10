# 📱 Building APK for BTC Recovery App

## Method 1: EAS Build (Recommended - Cloud Building)

### Prerequisites:
1. **Create Expo Account** (free): https://expo.dev/signup
2. **Install EAS CLI**: `npm install -g @expo/eas-cli`

### Steps:
```bash
cd /app/frontend
eas login
eas build --platform android --profile preview
```

The APK will be built in the cloud and downloadable via link.

## Method 2: Manual APK Building

### Prerequisites:
1. **Android Studio** installed on your computer
2. **Java Development Kit (JDK)** 11 or later
3. **Android SDK** and build tools

### Steps:
1. Convert Expo project to React Native CLI
2. Generate Android project files
3. Build APK with Android Studio or Gradle

## Method 3: Alternative APK Tools

### Using Cordova/PhoneGap wrapper:
1. Install Cordova: `npm install -g cordova`
2. Create Cordova project with web build
3. Add Android platform
4. Build APK

### Using Capacitor (Ionic):
1. Install Capacitor: `npm install -g @capacitor/cli`
2. Initialize Capacitor project
3. Add Android platform
4. Build APK

## Quick Online APK Builder (Easiest):

### Using Online Services:
1. **Website to APK**: https://websitetoapk.com/
2. **Appy Pie**: https://www.appypie.com/
3. **BuildFire**: https://buildfire.com/

#### Steps for Online Builder:
1. Use your app URL: https://btc-wallet-recovery.preview.emergentagent.com
2. Upload app icon and configure settings
3. Generate and download APK

## Pre-built Configuration Files Included:
- `eas.json` - EAS build configuration
- `app.json` - App metadata and settings
- Android icons and splash screens
