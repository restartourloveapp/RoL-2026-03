# Firebase Configuration

## Overview

This project uses environment-specific Firebase configurations for different deployment stages:
- **Test**: `rol-2026-test`
- **Acceptance**: `rol-2026-acc`
- **Production**: `rol-2026-prod`

## GitHub Actions Deployment

The CI/CD pipelines automatically generate `firebase-applet-config.json` from GitHub secrets:

- **Test pipeline** (test-deploy.yml): Uses `FIREBASE_CONFIG_TEST` secret
- **Acceptance pipeline** (acceptance-deploy.yml): Uses `FIREBASE_CONFIG_ACC` secret
- **Production pipeline** (production-deploy.yml): Uses `FIREBASE_CONFIG_PROD` secret

Each secret should contain a valid Firebase config JSON object.

### Configuring Secrets

To set up GitHub secrets for an environment:

1. Go to repository **Settings** → **Environments** → select environment (test/acceptance/production)
2. Add `FIREBASE_CONFIG_<ENV>` secret with the Firebase config JSON:

```json
{
  "projectId": "rol-2026-test",
  "appId": "1:66210783346:web:9c9bbdc645dd9c2e37e2eb",
  "apiKey": "AIzaSyDrDhwhxbDOG7LfDZnOR52GygsLg4--WS4",
  "authDomain": "rol-2026-test.firebaseapp.com",
  "storageBucket": "rol-2026-test.firebasestorage.app",
  "messagingSenderId": "66210783346",
  "measurementId": "G-V9G9NFQFWC"
}
```

Also configure these secrets for each environment:
- `FIREBASE_SERVICE_ACCOUNT_<ENV>`: The service account JSON from Firebase Console
- `FIREBASE_PROJECT_ID_<ENV>`: The Firebase project ID
- `STRIPE_PUBLIC_KEY_<ENV>`: Stripe public key
- `GEMINI_API_KEY_<ENV>`: Google Gemini API key

## Local Development

### For Test Environment

1. Copy the example file (already configured for test):
   ```bash
   cp firebase-applet-config.example.json firebase-applet-config.json
   ```

2. Or manually create `firebase-applet-config.json` with test Firebase credentials:
   ```json
   {
     "projectId": "rol-2026-test",
     "appId": "1:66210783346:web:9c9bbdc645dd9c2e37e2eb",
     "apiKey": "AIzaSyDrDhwhxbDOG7LfDZnOR52GygsLg4--WS4",
     "authDomain": "rol-2026-test.firebaseapp.com",
     "storageBucket": "rol-2026-test.firebasestorage.app",
     "messagingSenderId": "66210783346",
     "measurementId": "G-V9G9NFQFWC"
   }
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

**Important**: `firebase-applet-config.json` is **NOT tracked in Git** (.gitignore). Each developer must set it up locally.

## Firestore Rules Deployment

Firestore security rules are deployed via the CLI:

```bash
# Deploy to test environment
firebase deploy --only firestore:rules --project rol-2026-test

# Deploy to acceptance
firebase deploy --only firestore:rules --project rol-2026-acc

# Deploy to production
firebase deploy --only firestore:rules --project rol-2026-prod
```

## Configuration Validation

The build process uses `scripts/build-firebase-config.cjs` to:
1. Parse the Firebase config from GitHub secrets
2. Validate required fields (projectId, apiKey, etc.)
3. Generate the `firebase-applet-config.json` file
4. Output the PROJECT_ID for use in other build steps

If configuration parsing fails, the build will exit with an error.
