# Testplan & Checklist - Restart Our Love

Dit document bevat de kernfunctionaliteiten en beveiligingstesten voor de **Restart Our Love** applicatie.

---

## 1. Gebruikersbeheer & Authenticatie (Zero-Knowledge Vault)
- [ ] **Google Login:** Kan een gebruiker succesvol inloggen met Google?
- [ ] **E-mail/Wachtwoord Registratie:** Kan een nieuwe gebruiker een account aanmaken met e-mail en wachtwoord?
- [ ] **E-mail Verificatie:** Ontvangt de gebruiker een verificatie-e-mail na registratie? Wordt toegang geblokkeerd totdat de e-mail is geverifieerd?
- [ ] **E-mail/Wachtwoord Inloggen:** Kan een geverifieerde gebruiker inloggen met hun e-mail en wachtwoord?
- [ ] **PIN Instellen:** Wordt een nieuwe gebruiker gevraagd een 6-cijferige PIN in te stellen?
- [ ] **Kluis Ontgrendelen:** Wordt de PIN gevraagd bij het openen van de app na herladen? Wordt de encryptieservice correct geïnitialiseerd?
- [ ] **Onjuiste PIN:** Voorkomt een onjuiste PIN toegang en wordt er een duidelijke foutmelding getoond?
- [ ] **Sessie Persistentie:** Blijft de app ontgrendeld tijdens een sessie, maar is een PIN vereist na een volledige refresh of uitloggen?
- [ ] **Uitloggen:** Werkt de uitlogknop en worden alle lokale sleutels gewist?

## 2. Profiel & Onboarding
- [ ] **Initiële Setup:** Kan een gebruiker hun naam, voornaamwoorden en partnergegevens (indien van toepassing) instellen?
- [ ] **Coach Selectie Pagina:** Wordt de nieuwe toegewezen coach selectie pagina getoond tijdens de intake?
- [ ] **Coach Details:** Worden de bio, eigenschappen en methoden van de coaches correct weergegeven op de selectiepagina?
- [ ] **Gezamenlijke Coach Selectie:** Kan een gebruiker een coach kiezen die als standaard voor zowel relatie- als persoonlijke sessies wordt ingesteld?
- [ ] **Voornaamwoorden Selectie:** Test alle opties (hij/hem, zij/haar, hen/hun, anders) voor zowel gebruiker als partner.
- [ ] **Standaard Coach:** Wordt de geselecteerde standaard coach opgeslagen en gebruikt voor nieuwe sessies?
- [ ] **Profiel Bewerken:** Worden wijzigingen in Instellingen correct opgeslagen en gedecrypteerd weergegeven?
- [ ] **Coach Wijzigen in Instellingen:** Kunnen de gezamenlijke coach en de persoonlijke coach onafhankelijk van elkaar worden gewijzigd in het instellingenmenu?

## 3. Chatsessies & AI Coaching
- [ ] **Sessie Creatie:** Test het starten van zowel 'Persoonlijke' als 'Relatie' sessies.
- [ ] **Dashboard Welkomstblok:** Wordt het welkomstblok correct weergegeven met de namen van de partners?
- [ ] **Gratis Tier Info:** Toont het dashboard voor gratis gebruikers de voortgangsbalk (X van 3 sessies) en de "Word Premium" knop?
- [ ] **Premium Statistieken:** Toont het dashboard voor Premium gebruikers de statistieken (Totaal sessies, Berichten, Mijlpalen, Dagen op reis)?
- [ ] **Sessie Limiet (Dashboard):** Worden er maximaal 5 sessies getoond op het dashboard? Is er een link naar de Journey voor de volledige geschiedenis?
- [ ] **Gratis Sessie Limiet (Totaal):** Worden gratis gebruikers geblokkeerd voor het maken van een 4e sessie?
- [ ] **Sessie Verwijderen:** Kan een actieve sessie worden verwijderd? Wordt er om bevestiging gevraagd?
- [ ] **Sessie Verwijderen (Beëindigd):** Is de verwijderknop afwezig bij beëindigde sessies?
- [ ] **Coach Persona's:** Kunnen alle 5 coaches (Solin, Kael, Ravian, Amari, Leora) worden geselecteerd en reageren ze met hun unieke toon?
- [ ] **Versleutelde Berichten:** Worden berichten versleuteld verzonden naar Firestore en lokaal gedecrypteerd voor weergave?
- [ ] **AI Typing Indicator:** Is de "Coach is aan het typen..." status zichtbaar tijdens AI-generatie?
- [ ] **Crisis Detectie:** Worden crisis-sleutelwoorden (bijv. "Ik wil mezelf pijn doen") herkend en wordt de veiligheidswaarschuwing onmiddellijk getoond?
- [ ] **Gratis Bericht Limiet:** Worden gratis gebruikers geblokkeerd na 40 berichten in één sessie?
- [ ] **Geleidelijke Afsluiting:** Begint de AI tussen bericht 35 en 39 de conversatie geleidelijk af te ronden en de limiet te noemen?
- [ ] **Harde Stop:** Stopt de AI direct bij bericht 40 met een definitief afscheid?

## 4. Sessie Afsluiten & AI Inzichten
- [ ] **Sessie Beëindigen:** Werkt de "Sessie Afronden" knop?
- [ ] **Automatische Samenvatting:** Wordt er automatisch een samenvatting getoond na het afsluiten (indien >3 berichten)?
- [ ] **Subtiele CTA:** Bevat de samenvatting voor gratis gebruikers een subtiele suggestie voor Premium (geen expliciete "Call to Action")?
- [ ] **Opslaan in Sessie:** Is de samenvatting terug te vinden in het sessie-document in Firestore (als versleutelde map)?
- [ ] **Opslaan in Tijdlijn:** Wordt er een 'milestone' entry aangemaakt in de `timeline` collectie met de samenvatting?
- [ ] **Samenvatting Bekijken (Gesloten Sessie):**
    - [ ] Werkt de "Bekijk Samenvatting" knop in de header van een afgesloten sessie?
    - [ ] Wordt de samenvatting correct gedecrypteerd uit het sessie-document?
    - [ ] **Fallback Test:** Als de samenvatting in het sessie-document ontbreekt, wordt deze dan correct opgehaald uit de tijdlijn?

## 5. Journey & Relatie Voortgang
- [ ] **Huiswerkopdrachten:** Verschijnen AI-gegenereerde huiswerkopdrachten in de Journey-tab voor Premium gebruikers?
- [ ] **Taak Voltooiing:** Kan een huiswerktaak als "Gereed" worden gemarkeerd en verdwijnt deze uit de actieve lijst?
- [ ] **Tijdlijn Decryptie:** Worden alle items in de tijdlijn (Mijlpalen, Inzichten) correct gedecrypteerd met de juiste sessiesleutels?
- [ ] **Lege Staten:** Worden de juiste meldingen getoond als er nog geen huiswerk of tijdlijn-items zijn?

## 6. Partner Koppeling & Samenwerking
- [ ] **Partner Verzoek Sturen:** Kan een gebruiker een verzoek sturen via e-mail?
- [ ] **Partner Verzoek Ontvangen:** Ziet de partner het verzoek in hun instellingen?
- [ ] **Verzoek Accepteren:** Wordt de RK (Relationship Key) correct gegenereerd en uitgewisseld na acceptatie?
- [ ] **Gedeelde Sessies:** Kunnen beide partners deelnemen aan een 'Relatie' sessie zodra ze gekoppeld zijn?
- [ ] **Encryptie Handshake:** Wordt de Sessie Gedeelde Sleutel (SSK) correct "gewrapped" voor de partner zodat zij de geschiedenis kunnen inzien?

## 7. Veiligheid & Support
- [ ] **Crisis Bronnen:** Toont de Veiligheid-tab de juiste noodnummers en hulplijnen?
- [ ] **Support Tickets:** Kan een gebruiker een ticket aanmaken in Instellingen en verschijnt deze in de Admin-weergave?
- [ ] **Bijlagen:** Werkt het uploaden van een afbeelding/bestand bij een support ticket?

## 8. Premium Functionaliteiten
- [ ] **Upgrade Flow:** Opent de "Word Premium" knop de Stripe betaal-UI?
- [ ] **Feature Gating:** Worden Huiswerk en AI Tijdlijn-items *alleen* opgeslagen voor gebruikers met een Premium abonnement?
- [ ] **Onbeperkte Sessies:** Hebben Premium gebruikers geen last van de 40-berichten limiet?

## 9. Lokalisatie & UI/UX
- [ ] **Taalwissel:** Kan er gewisseld worden tussen Nederlands (NL) en Engels (EN) en wordt alle tekst correct vertaald?
- [ ] **Responsief Design:** Werkt de app goed op mobiel, tablet en desktop?
- [ ] **Safe Area Insets:** Respecteert de UI de "notch" gebieden op moderne mobiele apparaten?
- [ ] **Scrollbaarheid:** Scrollen lange lijsten (Instellingen, Tijdlijn, Chat) correct zonder te worden afgesneden?

## 10. Administratie (Wouter)
- [ ] **Admin Toegang:** Heeft `wouter.de.heer@gmail.com` toegang tot het admin-paneel?
- [ ] **Ticket Beheer:** Kunnen admins alle open tickets zien en markeren als "In behandeling" of "Opgelost"?
- [ ] **Resources Seeden:** Werkt de "Seed Resources" knop om standaard crisisgegevens in de database te laden?
