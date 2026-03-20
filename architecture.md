# Architectuur - Restart Our Love

Dit document beschrijft de functionele en technische opbouw van de "Restart Our Love" applicatie.

## 1. Functionele Componenten

De applicatie is ontworpen als een veilige, AI-gestuurde relatiecoach die privacy als hoogste prioriteit heeft.

### 1.1 Zero-Knowledge Beveiliging
*   **Client-Side Encryptie:** Alle gevoelige gegevens (berichten, profielen, samenvattingen) worden op het apparaat van de gebruiker versleuteld voordat ze naar de database worden verzonden.
*   **PIN-gebaseerde Sleutelafleiding:** De encryptiesleutels worden afgeleid van een door de gebruiker gekozen PIN via PBKDF2. De server slaat deze PIN of de resulterende sleutels nooit op.
*   **Kluis (Vault):** Gebruikers moeten hun PIN invoeren om de lokale "kluis" te openen en toegang te krijgen tot hun gegevens.

### 1.2 AI Coaching & Chat
*   **Coach Persona's:** Vijf verschillende AI-coaches (Solin, Kael, Ravian, Amari, Leora) met elk een unieke toon en specialisatie.
*   **Coach Selectie Pagina:** Een uitgebreide onboarding-stap waarin coaches zichzelf voorstellen met bio, eigenschappen en methoden, zodat gebruikers een weloverwogen gezamenlijke keuze kunnen maken.
*   **Sessietypes:** Ondersteuning voor zowel 'Persoonlijke' sessies (individueel) als 'Relatie' sessies (gedeeld met partner).
*   **Dashboard Overzicht:** Een centraal welkomstblok met gepersonaliseerde begroetingen, voortgangsinformatie voor gratis gebruikers (sessie-limieten) en diepgaande statistieken voor Premium gebruikers (totaal aantal sessies, berichten, mijlpalen en reisduur).
*   **Sessiebeheer:** Gebruikers kunnen maximaal 5 recente sessies op hun dashboard zien, met een volledige geschiedenis beschikbaar in de Journey. Actieve sessies kunnen worden verwijderd.
*   **Gratis Tier Limieten:** Gratis gebruikers zijn beperkt tot een totaal van 3 sessies en 40 berichten per sessie.
*   **Geleidelijke Conversatie-afsluiting:** De AI is geprogrammeerd om tussen bericht 35 en 39 de conversatie geleidelijk af te ronden en de naderende limiet te noemen, om een natuurlijke afsluiting te bevorderen.
*   **Real-time Interactie:** Berichten worden direct versleuteld en verzonden, met AI-antwoorden die contextueel relevant zijn.
*   **Crisisdetectie:** Ingebouwde detectie van zorgwekkende taal met onmiddellijke veiligheidswaarschuwingen en hulpmiddelen.

### 1.3 Relatiebeheer
*   **Partner Koppeling:** Een veilig proces om accounts te koppelen via e-mailuitnodigingen en een cryptografische handshake voor het delen van sessiesleutels.
*   **Gedeelde Tijdlijn:** Een gezamenlijk overzicht van mijlpalen, inzichten en huiswerkopdrachten.

### 1.4 Journey & Voortgang
*   **Tijdlijn (Timeline):** Automatisch gegenereerde samenvattingen en inzichten na elke sessie.
*   **Huiswerk:** AI-gegenereerde opdrachten om de relatie buiten de app te versterken (beschikbaar voor Premium gebruikers).

### 1.5 Abonnementen & Beheer
*   **Stripe Integratie:** Beheer van Free en Premium abonnementen.
*   **Admin Paneel:** Voor support tickets en het beheren van crisis-bronnen.

---

## 2. Technische Componenten

De applicatie maakt gebruik van een moderne full-stack architectuur met een sterke focus op beveiliging en schaalbaarheid.

### 2.1 Frontend (Client-side)
*   **Framework:** React 18+ met Vite als build-tool.
*   **Styling:** Tailwind CSS voor een responsief en modern design.
*   **Animaties:** Framer Motion voor vloeiende transities en interacties.
*   **Icons:** Lucide React.
*   **State Management:** React Hooks (useState, useEffect, useContext) voor applicatie-logica.

### 2.2 Backend (Server-side)
*   **Runtime:** Node.js met Express.
*   **API Proxy:** Handelt Stripe webhooks af en fungeert als beveiligde laag voor server-side operaties.
*   **Vite Middleware:** Integreert de frontend build in de Express server voor productie.

### 2.3 Database & Authenticatie
*   **Firebase Firestore:** NoSQL database voor het opslaan van (versleutelde) documenten.
*   **Firebase Auth:** Ondersteuning voor zowel **Google Login** als **E-mail/Wachtwoord** authenticatie.
*   **E-mail Verificatie:** Verplichte verificatie voor e-mail/wachtwoord accounts om de veiligheid te waarborgen.
*   **Firestore Security Rules:** Strikte regels die ervoor zorgen dat gebruikers alleen toegang hebben tot hun eigen (of gedeelde) data.

### 2.4 Cryptografie (Web Crypto API)
*   **AES-GCM:** Gebruikt voor de eigenlijke versleuteling van data.
*   **PBKDF2:** Gebruikt om een sterke cryptografische sleutel af te leiden van de gebruikers-PIN.
*   **RSA-OAEP:** Gebruikt voor de asymmetrische handshake bij het koppelen van partners.

### 2.5 AI Integratie
*   **Google Gemini API:** Gebruik van `@google/genai` voor het genereren van coach-antwoorden, samenvattingen en huiswerk.
*   **Safety Filters:** Configuratie van AI-veiligheidsinstellingen om ongepaste content te voorkomen.

### 2.6 Externe Diensten
*   **Stripe:** Voor betalingsverwerking en abonnementsbeheer.
*   **Firebase Admin SDK:** Gebruikt op de server voor het verifiëren van tokens en het beheren van Firestore met verhoogde rechten waar nodig (bijv. Stripe webhooks).
