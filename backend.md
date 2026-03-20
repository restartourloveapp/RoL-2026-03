# Backend Configuratie & Deployment - Restart Our Love

Dit document beschrijft de backend architectuur, de benodigde cloud-configuraties en de stappen om de applicatie te publiceren op een nieuw Google-account.

## 1. Backend Architectuur

De backend is een hybride setup die gebruikmaakt van Node.js/Express voor server-side logica en Firebase voor data en authenticatie.

### 1.1 Express Server (`server.ts`)
*   **Vite Middleware:** In development draait de frontend via Vite middleware binnen Express. In productie serveert Express de statische bestanden uit de `dist/` map.
*   **Stripe Integratie:** Bevat endpoints voor het aanmaken van Checkout-sessies en een webhook-handler voor het verwerken van betalingen.
*   **Firebase Admin SDK:** Wordt gebruikt voor server-side toegang tot Firestore (bijv. updaten van abonnementstatus na betaling).

### 1.2 Omgevingsvariabelen
De volgende variabelen zijn vereist in de productieomgeving:
*   `GEMINI_API_KEY`: Voor de AI-functionaliteit.
*   `STRIPE_SECRET_KEY`: Voor betalingsverwerking.
*   `APP_URL`: De publieke URL van de applicatie (nodig voor Stripe redirects).
*   `GOOGLE_APPLICATION_CREDENTIALS`: (Optioneel) Pad naar de service account key als er buiten GCP wordt gedraaid.

---

## 2. Google Cloud Platform (GCP) Configuratie

De applicatie is ontworpen om te draaien op **Google Cloud Run**.

### 2.1 Project Setup
1.  Maak een nieuw GCP-project aan.
2.  Schakel de volgende API's in:
    *   Cloud Run API
    *   Cloud Build API
    *   Artifact Registry API
    *   Secret Manager API

### 2.2 IAM & Rechten
De Cloud Run service account heeft de volgende rollen nodig:
*   `Cloud Datastore User` (voor Firestore toegang via Admin SDK)
*   `Secret Manager Secret Accessor` (voor het ophalen van API keys)

---

## 3. Firebase Configuratie

### 3.1 Firestore Setup
1.  Activeer Firestore in de "Native Mode".
2.  Maak de benodigde collecties aan (of laat de app dit doen bij de eerste write): `users`, `sessions`, `messages`, `timeline`, `homework`, `support_tickets`, `resources`.
3.  **Gebruikersprofiel:** Het `users` document bevat nu zowel `defaultCoupleCoach` als `personalCoach` velden, die beide versleuteld worden opgeslagen.
4.  **Belangrijk:** Gebruik de `firestore.rules` uit dit project om de database te beveiligen.

### 3.2 Authenticatie
1.  Activeer de **Google** sign-in provider in de Firebase Console.
2.  Activeer de **Email/Password** sign-in provider.
3.  Schakel **Email link (passwordless sign-in)** in indien gewenst, of houd het bij standaard wachtwoord.
4.  Configureer de **Email templates** (verificatie, wachtwoord reset) in de Firebase Console.
5.  Voeg de domeinen van je Cloud Run service toe aan de "Authorized domains".

### 3.3 Storage
1.  Activeer Firebase Storage voor het opslaan van bijlagen bij support tickets.

---

## 4. GitHub CI/CD (GitHub Actions)

Voor automatische deployment naar Cloud Run kun je een workflow bestand (`.github/workflows/deploy.yml`) aanmaken.

### 4.1 Benodigde Secrets in GitHub
*   `GCP_PROJECT_ID`: ID van je Google Cloud project.
*   `GCP_SA_KEY`: JSON key van een service account met `Editor` of `Cloud Run Admin` rechten.
*   `GEMINI_API_KEY`: Voor de AI-functionaliteit (indien niet in Secret Manager).
*   `STRIPE_SECRET_KEY`: Voor betalingsverwerking (indien niet in Secret Manager).

### 4.2 Workflow Stappen
1.  **Checkout:** Haal de code op.
2.  **Auth:** Log in bij GCP met de service account key.
3.  **Build & Push:** Bouw een Docker image en push deze naar de Artifact Registry.
4.  **Deploy:** Update de Cloud Run service met de nieuwe image.

---

## 5. Instructies voor Publicatie op een ander Google Account

Volg deze stappen om de app volledig te verhuizen naar een nieuw account:

### Stap 1: Nieuw GCP & Firebase Project
1.  Log in op het nieuwe Google-account.
2.  Maak een nieuw project aan in de [Firebase Console](https://console.firebase.google.com/).
3.  Volg de stappen in sectie 3 (Firestore, Auth, Storage).

### Stap 2: Configuratie Update
1.  Download het nieuwe `google-services.json` (voor Android/iOS) of kopieer de Web Config.
2.  Update `firebase-applet-config.json` in de root van dit project met de nieuwe waarden:
    *   `projectId`
    *   `appId`
    *   `apiKey`
    *   `authDomain`
    *   `firestoreDatabaseId` (indien een specifieke database is aangemaakt)

### Stap 3: API Keys & Secrets
1.  Maak een nieuwe API Key aan in de [Google AI Studio](https://aistudio.google.com/) onder het nieuwe account.
2.  Maak een nieuw Stripe account aan (of gebruik een bestaande) en haal de `Secret Key` op.
3.  Voeg deze keys toe aan de Cloud Run omgevingsvariabelen of Secret Manager.

### Stap 4: Deployment
1.  Zorg dat de `APP_URL` in de omgevingsvariabelen overeenkomt met de nieuwe Cloud Run URL.
2.  Update de Stripe Webhook URL in het Stripe dashboard naar `https://<jouw-nieuwe-url>/api/webhook`.
3.  Voer een `npm run build` uit en deploy de container naar de nieuwe Cloud Run service.

### Stap 5: Domein & SSL
1.  Koppel eventueel een custom domein aan de Cloud Run service via de GCP Console. Google regelt automatisch de SSL-certificaten.
