# Restart Our Love - Implementation Roadmap

## Phase 1: Foundation (Weeks 1–3)
- [x] Firebase Initialization (Auth, Firestore, Hosting)
- [x] Mobile-First UI Refactor (Bottom Nav, Full-screen Chat)
- [x] PIN Encryption (Basic PBKDF2 implementation)
- [x] Personal Chat (1-on-1 with AI Coach)
- [x] Finalize Coach Prototypes (Detailed persona prompts)
- [x] Implement Firestore Schema (`firebase-blueprint.json`)
- [x] Hardened Firestore Security Rules (`firestore.rules`)

## Phase 2: Collaboration & Partner Mode (Weeks 4–7)
- [x] Implement Session Symmetric Keys (SSK) logic
- [x] Create partner-device connection code workflow (main account + partner account linking)
- [x] Implement "Owner rewraps SSK for Partner" logic (RK)
- [x] Couple Chat (Three-Way) with real-time listeners
- [x] Turn-taking and communication guidance UI (AI-powered Tips)

## Phase 3: Insights & Token Optimization (Weeks 8–10)
- [x] Server-side AI Context Assembly (via server.ts)
- [x] Progressive Summarization (Checkpoint summaries every 10 msgs)
- [x] Timeline & Homework tracking system
- [x] Token reduction logic (Summary-based context)

## Phase 4: Support & Ticketing (Weeks 10–12)
- [x] Ticketing System (`/tickets`)
- [x] Plaintext Snippet consent flow
- [x] Firebase Storage integration for attachments
- [x] Admin Dashboard for support snippets

## Phase 5: Mobile Native Integration (Weeks 12–15)
- [ ] Capacitor Wrapper setup
- [ ] Native Secure Storage (Keystore/Keychain)
- [ ] Biometric Unlock (FaceID/TouchID)
- [ ] Push Notifications (FCM)
- [ ] Auto-lock on background logic

## Phase 6: Launch Readiness (Weeks 15–16)
- [x] Final Security Audit & E2EE Verification (Prototype complete)
- [x] Safety Layer (Crisis detection & escalation)
- [x] Stripe Subscription Management
- [ ] App Store & Play Store submission
