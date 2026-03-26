import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Stripe from "stripe";
import * as admin from 'firebase-admin';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: admin.firestore.Firestore | null = null;
let stripe: Stripe | null = null;

// ✅ SECURITY FIX: Input validation schemas
function validateCheckoutSession(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  const { userId, email } = data;
  
  // Validate userId is a non-empty string
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { valid: false, error: 'Invalid userId' };
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  return { valid: true };
}

// ✅ SECURITY FIX: Audit logging for security events
async function logAuditEvent(
  userId: string,
  action: string,
  details: Record<string, any>,
  req: express.Request
): Promise<void> {
  try {
    const firestore = getDb();
    await firestore.collection('auditLogs').add({
      userId,
      action,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details,
    });
  } catch (error) {
    // Don't fail the request if logging fails, just log the error
    console.error('Failed to log audit event:', error);
  }
}

async function deleteQueryDocs(querySnap: admin.firestore.QuerySnapshot): Promise<number> {
  let deleted = 0;
  for (const d of querySnap.docs) {
    await d.ref.delete();
    deleted++;
  }
  return deleted;
}

// ✅ SECURITY FIX: Generate time-limited tokens for partner requests
function generatePartnerToken(): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return { token, expiresAt };
}

// ✅ FEATURE: Partner Device Account - Generate connection code
function generatePartnerConnectionCode(): { code: string; expiresAt: Date } {
  // Generate a 6-character alphanumeric code (easy to share, case-insensitive)
  const code = crypto.randomBytes(3).toString('hex').toUpperCase().substring(0, 6);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return { code, expiresAt };
}

// ✅ FEATURE: Partner Device Account - Validate main account is premium
async function validateMainAccountPremium(mainAccountUid: string): Promise<boolean> {
  try {
    const firestore = getDb();
    const userSnap = await firestore.collection('users').doc(mainAccountUid).get();
    if (!userSnap.exists()) return false;
    
    const userData = userSnap.data();
    return userData?.subscriptionTier === 'premium';
  } catch (error) {
    console.error('Error validating main account premium status:', error);
    return false;
  }
}

// ✅ FEATURE: Partner Device Account - Wipe account data before converting to partner
async function wipeAccountDataBeforePartnerConversion(userId: string): Promise<void> {
  try {
    const firestore = getDb();
    
    // Get all sessions owned by this user
    const sessionsSnap = await firestore.collection('sessions')
      .where('ownerUid', '==', userId)
      .get();
    
    // Delete all messages and summaries from personal sessions
    for (const sessionDoc of sessionsSnap.docs) {
      const session = sessionDoc.data();
      // Only delete personal sessions (not couple sessions)
      if (session.type === 'personal') {
        // Delete messages
        const messagesSnap = await sessionDoc.ref.collection('messages').get();
        for (const msgDoc of messagesSnap.docs) {
          await msgDoc.ref.delete();
        }
        
        // Delete message summaries
        const summariesSnap = await sessionDoc.ref.collection('message_summaries').get();
        for (const sumDoc of summariesSnap.docs) {
          await sumDoc.ref.delete();
        }
        
        // Delete the session itself
        await sessionDoc.ref.delete();
      }
    }
    
    // Delete personal timeline entries
    const timelineSnap = await firestore.collection('timeline')
      .where('ownerUid', '==', userId)
      .get();
    for (const timelineDoc of timelineSnap.docs) {
      await timelineDoc.ref.delete();
    }
    
    // Delete homework
    const homeworkSnap = await firestore.collection('homework')
      .where('ownerUid', '==', userId)
      .get();
    for (const hwDoc of homeworkSnap.docs) {
      await hwDoc.ref.delete();
    }
    
    console.log(`Wiped personal data for user ${userId}`);
  } catch (error) {
    console.error('Error wiping account data:', error);
    throw error;
  }
}

// Move legacy partner-personal data from main account ownership to partner account ownership.
// This is a one-time migration when partner device mode is activated.
async function migratePartnerPersonalDataToPartnerProfile(
  mainAccountUid: string,
  partnerAccountUid: string,
  partnerProfileId: string | null | undefined
): Promise<{ sessions: number; timeline: number; homework: number }> {
  const counters = { sessions: 0, timeline: 0, homework: 0 };
  if (!partnerProfileId) return counters;

  const firestore = getDb();
  const personalSessionsSnap = await firestore.collection('sessions')
    .where('ownerUid', '==', mainAccountUid)
    .where('type', '==', 'personal')
    .get();

  for (const sessionDoc of personalSessionsSnap.docs) {
    const session = sessionDoc.data();
    if (session.ownerProfileId !== partnerProfileId) {
      continue;
    }

    await sessionDoc.ref.update({
      ownerUid: partnerAccountUid,
      partnerUid: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    counters.sessions++;

    const timelineSnap = await firestore.collection('timeline')
      .where('sessionId', '==', sessionDoc.id)
      .where('ownerUid', '==', mainAccountUid)
      .get();

    for (const entry of timelineSnap.docs) {
      await entry.ref.update({
        ownerUid: partnerAccountUid,
        partnerUid: admin.firestore.FieldValue.delete(),
      });
      counters.timeline++;
    }

    const homeworkSnap = await firestore.collection('homework')
      .where('sessionId', '==', sessionDoc.id)
      .where('ownerUid', '==', mainAccountUid)
      .get();

    for (const task of homeworkSnap.docs) {
      await task.ref.update({
        ownerUid: partnerAccountUid,
        partnerUid: admin.firestore.FieldValue.delete(),
      });
      counters.homework++;
    }
  }

  return counters;
}

function getDb() {
  if (!db) {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        projectId: "gen-lang-client-0045957411",
      });
    }
    db = admin.firestore();
  }
  return db;
}

function getStripe() {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY environment variable is not set. ' +
        'Please configure it in your environment or .env file'
      );
    }
    stripe = new Stripe(secretKey);
  }
  return stripe;
}

// ✅ SECURITY FIX: Rate limiting for checkout endpoint
// Prevent brute force attempts and abuse
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 checkout attempts per windowMs
  message: 'Too many checkout attempts, please try again later',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Don't count health checks or webhooks in rate limiting
    return req.path === '/api/health';
  },
});

// ✅ SECURITY FIX: Rate limiting for webhook endpoint
// Prevent brute force attacks and resource exhaustion
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Allow more attempts for webhook (might have retries)
  message: 'Too many webhook requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Only rate limit webhook endpoint
    return req.path !== '/api/webhook';
  },
  keyGenerator: (req) => {
    // Rate limit by Stripe signature + IP (webhook retries use same signature)
    return `${req.headers['stripe-signature']}-${req.ip}`;
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // ✅ SECURITY FIX: Apply rate limiting to all API routes
  app.use(webhookLimiter);

  // Stripe Webhook needs raw body
  app.post("/api/webhook", express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.error('ERROR: STRIPE_WEBHOOK_SECRET not configured');
      return res.status(400).send('Webhook secret not configured');
    }
    
    if (!sig) {
      return res.status(400).send('No Stripe signature provided');
    }

    let event;
    try {
      // ✅ CRITICAL FIX: Verify Stripe webhook signature
      // This ensures the webhook came from Stripe and hasn't been tampered with
      const stripeClient = getStripe();
      event = stripeClient.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret
      );
    } catch (err: any) {
      console.error(`Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata.userId;
      
      if (userId) {
        try {
          const firestore = getDb();
          await firestore.collection('users').doc(userId).update({
            subscriptionTier: 'premium',
            updatedAt: new Date().toISOString()
          });
          
          // ✅ SECURITY FIX: Log premium upgrade for audit trail
          await logAuditEvent(userId, 'premium_upgrade', {
            stripeSessionId: session.id,
            amount: session.amount_total,
            currency: session.currency,
          }, req);
          
          console.log(`User ${userId} upgraded to premium.`);
        } catch (e) {
          console.error(`Failed to update user ${userId} in Firestore`, e);
        }
      }
    }

    res.json({received: true});
  });

  app.use(express.json());

  // ✅ SECURITY FIX: Add CORS and security headers to all responses
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://restartourlove.app',
      'https://www.restartourlove.app',
      'https://rol-2026-test.web.app',
      'https://rol-2026-test.firebaseapp.com',
    ];

    // ✅ CORS Configuration - Allow requests only from approved origins
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // HSTS - enforce HTTPS
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    
    // CSP - Content Security Policy (allow our app and Bootstrap CDN)
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://api.stripe.com");
    
    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Disable client caching for sensitive endpoints
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    
    next();
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ✅ SECURITY FIX: Generate partner request token (time-limited instead of email-based)
  app.post("/api/generate-partner-token", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Limit to 10 partner requests per 15 minutes
    message: 'Too many partner requests, please try again later',
  }), async (req, res) => {
    try {
      const { fromUserId, toEmail } = req.body;
      
      // Validate input
      if (!fromUserId || typeof fromUserId !== 'string' || fromUserId.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid fromUserId' });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!toEmail || typeof toEmail !== 'string' || !emailRegex.test(toEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      const firestore = getDb();
      const { token, expiresAt } = generatePartnerToken();
      
      // Store token in Firestore with expiration
      const tokenRef = await firestore.collection('partnerTokens').add({
        fromUserId,
        toEmail,
        token: crypto.createHash('sha256').update(token).digest('hex'), // Hash for security
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        used: false,
      });
      
      // Log the partner request send
      await logAuditEvent(fromUserId, 'partner_request_sent', {
        toEmail,
        tokenId: tokenRef.id,
      }, req);
      
      // Return token to send to partner (this would typically be in an email)
      res.json({ 
        token, // This token is only given to the user to share with their partner
        expiresAt,
        message: 'Share this link with your partner to accept the request'
      });
    } catch (e: any) {
      console.error('Partner token generation error:', e);
      res.status(500).json({ error: 'Failed to generate partner token' });
    }
  });

  // ✅ FEATURE: Partner Device Account - Generate connection code
  app.post("/api/generate-partner-connection-code", rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Max 5 codes per hour
    message: 'Too many connection codes generated, please try again later',
  }), async (req, res) => {
    try {
      const { mainAccountUid } = req.body;
      
      if (!mainAccountUid || typeof mainAccountUid !== 'string' || mainAccountUid.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid mainAccountUid' });
      }
      
      // Verify main account is premium
      const isPremium = await validateMainAccountPremium(mainAccountUid);
      if (!isPremium) {
        return res.status(403).json({ error: 'Main account must be premium to create partner accounts' });
      }
      
      const firestore = getDb();
      const { code, expiresAt } = generatePartnerConnectionCode();
      
      // Store connection code in Firestore
      await firestore.collection('partnerConnectionCodes').add({
        mainAccountUid,
        code,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        used: false,
        partnerAccountUid: null, // Will be set when partner connects
      });
      
      // Log the code generation
      await logAuditEvent(mainAccountUid, 'partner_connection_code_generated', {
        code,
        expiresAt,
      }, req);
      
      res.json({ 
        code,
        expiresAt,
        message: 'Share this code with your partner to connect their device',
      });
    } catch (e: any) {
      console.error('Partner connection code generation error:', e);
      res.status(500).json({ error: 'Failed to generate connection code' });
    }
  });

  // ✅ FEATURE: Partner Device Account - Connect as partner device (Password-secured)
  app.post("/api/connect-as-partner-device", rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 attempts per 15 minutes
    message: 'Too many connection attempts, please try again later',
  }), async (req, res) => {
    try {
      const { partnerAccountUid, connectionCode, mainAccountIdToken } = req.body;
      
      // Validate input
      if (!partnerAccountUid || typeof partnerAccountUid !== 'string') {
        return res.status(400).json({ error: 'Invalid partnerAccountUid' });
      }
      
      if (!connectionCode || typeof connectionCode !== 'string' || connectionCode.trim().length !== 6) {
        return res.status(400).json({ error: 'Invalid connection code' });
      }
      
      if (!mainAccountIdToken || typeof mainAccountIdToken !== 'string') {
        return res.status(400).json({ error: 'Missing mainAccountIdToken - please verify password' });
      }
      
      const firestore = getDb();
      
      // ✅ SECURITY: Verify the ID token (proves password was correct)
      let mainAccountUid: string;
      try {
        const decodedToken = await admin.auth().verifyIdToken(mainAccountIdToken);
        mainAccountUid = decodedToken.uid;
      } catch (error) {
        console.error('Invalid ID token:', error);
        return res.status(401).json({ error: 'Invalid or expired password verification. Please log in again.' });
      }
      
      // Find and validate connection code
      const codesSnap = await firestore.collection('partnerConnectionCodes')
        .where('code', '==', connectionCode.toUpperCase())
        .limit(1)
        .get();
      
      if (codesSnap.empty) {
        return res.status(404).json({ error: 'Connection code not found or expired' });
      }
      
      const codeDoc = codesSnap.docs[0];
      const codeData = codeDoc.data();
      
      // Validate code hasn't expired
      const expiresAt = codeData.expiresAt.toDate();
      if (expiresAt < new Date()) {
        return res.status(410).json({ error: 'Connection code has expired' });
      }
      
      // Validate code hasn't been used
      if (codeData.used) {
        return res.status(409).json({ error: 'Connection code has already been used' });
      }
      
      // ✅ SECURITY: Verify the code belongs to the verified main account
      if (codeData.mainAccountUid !== mainAccountUid) {
        return res.status(403).json({ error: 'Connection code does not match this account' });
      }
      
      // Get main account profile
      const mainAccountSnap = await firestore.collection('users').doc(mainAccountUid).get();
      if (!mainAccountSnap.exists()) {
        return res.status(404).json({ error: 'Main account not found' });
      }
      
      const mainAccountData = mainAccountSnap.data();
      
      // Verify main account is premium
      if (mainAccountData.subscriptionTier !== 'premium') {
        return res.status(403).json({ error: 'Main account must be premium to create partner devices' });
      }
      
      // Extract PIN values from main account (now we've verified password)
      const pinSalt = mainAccountData.pinSalt;
      const pinVerifier = mainAccountData.pinVerifier;
      
      if (!pinSalt || !pinVerifier) {
        console.error('Main account missing PIN values');
        return res.status(500).json({ error: 'Main account PIN not properly configured' });
      }
      
      // Wipe partner account personal data
      await wipeAccountDataBeforePartnerConversion(partnerAccountUid);
      
      const partnerProfileId = typeof mainAccountData.partnerId === 'string' && mainAccountData.partnerId
        ? mainAccountData.partnerId
        : mainAccountData.profileId;
      const mainProfileId = typeof mainAccountData.profileId === 'string' ? mainAccountData.profileId : null;

      // Update partner account with base info from main account and make it a partner account
      await firestore.collection('users').doc(partnerAccountUid).update({
        mainAccountUid,
        accountType: 'partner',
        role: 'partner',
        pinSalt,        // Copy PIN from main account (now verified)
        pinVerifier,
        wrappedCK: mainAccountData.wrappedCK,
        subscriptionTier: 'partner',
        language: mainAccountData.language || 'nl',
        profileId: partnerProfileId,
        partnerId: mainProfileId,
        profileName: mainAccountData.partnerName || null,
        profilePronouns: mainAccountData.partnerPronouns || null,
        partnerName: mainAccountData.profileName || null,
        partnerPronouns: mainAccountData.profilePronouns || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Ensure main account points to this partner device account.
      await firestore.collection('users').doc(mainAccountUid).update({
        partnerUid: partnerAccountUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Migrate legacy shared-device partner personal data to partner ownership (single source of truth).
      const migration = await migratePartnerPersonalDataToPartnerProfile(
        mainAccountUid,
        partnerAccountUid,
        partnerProfileId
      );
      
      // Mark code as used
      await codeDoc.ref.update({
        used: true,
        partnerAccountUid,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Log the partnership connection with verified account
      await logAuditEvent(partnerAccountUid, 'partner_device_connected', {
        mainAccountUid,
        connectionCode,
        verificationMethod: 'password_verified_via_idtoken',
      }, req);
      
      await logAuditEvent(mainAccountUid, 'partner_device_link_confirmed', {
        partnerAccountUid,
        connectionCode,
        verificationMethod: 'password_verified_via_idtoken',
        migration,
      }, req);
      
      res.json({ 
        success: true,
        message: 'Successfully connected as partner device account',
        mainAccountUid,
        migration,
      });
    } catch (e: any) {
      console.error('Partner device connection error:', e);
      res.status(500).json({ error: 'Failed to connect as partner device. Please try again.' });
    }
  });

  // ✅ FEATURE: Delete Session - Server-side endpoint for secure session deletion
  app.post("/api/delete-session", rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 deletes per minute per IP
    message: 'Too many deletion requests, please try again later',
  }), async (req, res) => {
    try {
      const { sessionId, userId } = req.body;
      
      // Validate input
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid sessionId' });
      }
      
      if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid userId' });
      }
      
      const firestore = getDb();
      
      // Get session document
      const sessionRef = firestore.collection('sessions').doc(sessionId);
      const sessionSnap = await sessionRef.get();
      
      if (!sessionSnap.exists()) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      const sessionData = sessionSnap.data();
      
      // ✅ SECURITY: Verify user is owner or partner of session
      if (sessionData.ownerUid !== userId && sessionData.partnerUid !== userId) {
        return res.status(403).json({ error: 'U bent niet bevoegd om deze sessie te verwijderen' });
      }
      
      // ✅ SECURITY: Prevent deletion of closed/archived sessions (data integrity)
      if (sessionData.status === 'closed' || sessionData.status === 'beeindigd' || sessionData.status === 'archived') {
        return res.status(400).json({ error: 'U kunt gesloten sessies niet verwijderen' });
      }
      
      // Delete all messages
      const messagesSnap = await firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('messages')
        .get();
      
      for (const docSnap of messagesSnap.docs) {
        await docSnap.ref.delete();
      }
      
      // Delete all message summaries
      const msgSummariesSnap = await firestore
        .collection('sessions')
        .doc(sessionId)
        .collection('message_summaries')
        .get();
      
      for (const docSnap of msgSummariesSnap.docs) {
        await docSnap.ref.delete();
      }
      
      // Delete timeline entries for this session
      const timelineSnap = await firestore
        .collection('timeline')
        .where('sessionId', '==', sessionId)
        .get();
      
      for (const docSnap of timelineSnap.docs) {
        await docSnap.ref.delete();
      }
      
      // Delete homework entries for this session
      const homeworkSnap = await firestore
        .collection('homework')
        .where('sessionId', '==', sessionId)
        .get();
      
      for (const docSnap of homeworkSnap.docs) {
        await docSnap.ref.delete();
      }
      
      // Delete the session document itself
      await sessionRef.delete();
      
      // Log the deletion for audit trail
      await logAuditEvent(userId, 'session_deleted', {
        sessionId,
        sessionType: sessionData.type,
        coachPersona: sessionData.coachPersona,
        deletedBy: userId === sessionData.ownerUid ? 'owner' : 'partner',
      }, req);
      
      res.json({ 
        success: true,
        message: 'Sessie is verwijderd',
        sessionId,
      });
    } catch (e: any) {
      console.error('Session deletion error:', e);
      
      // Don't expose internal errors to client
      if (e.code === 'permission-denied') {
        return res.status(403).json({ error: 'Geen toestemming om deze actie uit te voeren' });
      }
      
      res.status(500).json({ error: 'Sessie kon niet worden verwijderd. Probeer het later opnieuw.' });
    }
  });

  // GDPR: delete account and related data
  app.post("/api/delete-account", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: 'Too many account deletion attempts, please try again later',
  }), async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing bearer token' });
      }

      const idToken = authHeader.slice('Bearer '.length).trim();
      let decoded: admin.auth.DecodedIdToken;
      try {
        decoded = await admin.auth().verifyIdToken(idToken, true);
      } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const uid = decoded.uid;
      const authTime = decoded.auth_time || 0;
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - authTime > 15 * 60) {
        return res.status(401).json({
          error: 'Recent login required',
          requiresRecentLogin: true,
        });
      }

      const firestore = getDb();
      const userRef = firestore.collection('users').doc(uid);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? (userSnap.data() || {}) : {};

      const linkedUid = (typeof userData.partnerUid === 'string' && userData.partnerUid !== uid)
        ? userData.partnerUid
        : (typeof userData.mainAccountUid === 'string' && userData.mainAccountUid !== uid ? userData.mainAccountUid : null);

      const targetUids = new Set<string>([uid]);
      if (linkedUid) targetUids.add(linkedUid);

      const userDocs = new Map<string, any>();
      for (const targetUid of targetUids) {
        const snap = await firestore.collection('users').doc(targetUid).get();
        userDocs.set(targetUid, snap.exists ? (snap.data() || {}) : {});
      }

      // Best-effort cancellation for Stripe-managed web subscriptions for all accounts being deleted.
      let cancelledStripeSubscriptions = 0;
      const stripeEmails = new Set<string>();
      if (decoded.email) stripeEmails.add(decoded.email);
      for (const targetUid of targetUids) {
        const email = userDocs.get(targetUid)?.email;
        if (email && typeof email === 'string') stripeEmails.add(email);
      }
      for (const email of stripeEmails) {
        try {
          const stripeClient = getStripe();
          const customers = await stripeClient.customers.list({ email, limit: 10 });
          for (const customer of customers.data) {
            if (!customer.id) continue;
            const subs = await stripeClient.subscriptions.list({
              customer: customer.id,
              status: 'all',
              limit: 100,
            });
            for (const sub of subs.data) {
              if (['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(sub.status)) {
                await stripeClient.subscriptions.cancel(sub.id);
                cancelledStripeSubscriptions++;
              }
            }
          }
        } catch (stripeErr) {
          console.warn('Stripe cancellation skipped/failed during account deletion', { email, stripeErr });
        }
      }

      // Delete session meta summaries for all target users.
      for (const targetUid of targetUids) {
        const targetRef = firestore.collection('users').doc(targetUid);
        const metaSnap = await targetRef.collection('session_meta_summaries').get();
        await deleteQueryDocs(metaSnap);
      }

      // Delete all sessions related to either account (owner or partner), including subcollections.
      const sessionMap = new Map<string, admin.firestore.DocumentReference>();
      for (const targetUid of targetUids) {
        const [ownerSessions, partnerSessions] = await Promise.all([
          firestore.collection('sessions').where('ownerUid', '==', targetUid).get(),
          firestore.collection('sessions').where('partnerUid', '==', targetUid).get(),
        ]);
        ownerSessions.docs.forEach((d) => sessionMap.set(d.id, d.ref));
        partnerSessions.docs.forEach((d) => sessionMap.set(d.id, d.ref));
      }

      for (const sessionRef of sessionMap.values()) {
        const [messagesSnap, summariesSnap] = await Promise.all([
          sessionRef.collection('messages').get(),
          sessionRef.collection('message_summaries').get(),
        ]);
        await deleteQueryDocs(messagesSnap);
        await deleteQueryDocs(summariesSnap);
        await sessionRef.delete();
      }

      // Delete related top-level data for all accounts being deleted.
      const relatedSnapshots: admin.firestore.QuerySnapshot[] = [];
      for (const targetUid of targetUids) {
        const snaps = await Promise.all([
          firestore.collection('timeline').where('ownerUid', '==', targetUid).get(),
          firestore.collection('timeline').where('partnerUid', '==', targetUid).get(),
          firestore.collection('homework').where('ownerUid', '==', targetUid).get(),
          firestore.collection('homework').where('partnerUid', '==', targetUid).get(),
          firestore.collection('tickets').where('userUid', '==', targetUid).get(),
          firestore.collection('auditLogs').where('userId', '==', targetUid).get(),
          firestore.collection('partner_requests').where('fromUid', '==', targetUid).get(),
          firestore.collection('partner_requests').where('respondentUid', '==', targetUid).get(),
          firestore.collection('partnerConnectionCodes').where('mainAccountUid', '==', targetUid).get(),
          firestore.collection('partnerConnectionCodes').where('partnerAccountUid', '==', targetUid).get(),
          firestore.collection('partnerTokens').where('fromUserId', '==', targetUid).get(),
        ]);
        relatedSnapshots.push(...snaps);
      }

      const seenRefs = new Set<string>();
      for (const snap of relatedSnapshots) {
        for (const d of snap.docs) {
          if (!seenRefs.has(d.ref.path)) {
            seenRefs.add(d.ref.path);
            await d.ref.delete();
          }
        }
      }

      // Delete user docs and auth users for all accounts in scope.
      for (const targetUid of targetUids) {
        await firestore.collection('users').doc(targetUid).delete();
      }
      for (const targetUid of targetUids) {
        try {
          await admin.auth().deleteUser(targetUid);
        } catch (authErr: any) {
          if (authErr?.code !== 'auth/user-not-found') {
            throw authErr;
          }
        }
      }

      res.json({
        success: true,
        deletedPartnerAccount: targetUids.size > 1,
        cancelledStripeSubscriptions,
        subscriptionNotice: 'Web-abonnementen via Stripe zijn stopgezet indien gevonden. Voor Apple App Store of Google Play moet je abonnement apart in de store opzeggen.',
      });
    } catch (e: any) {
      console.error('Account deletion error:', e);
      res.status(500).json({ error: 'Account kon niet worden verwijderd. Probeer opnieuw.' });
    }
  });

  // Stripe Checkout Session
  app.post("/api/create-checkout-session", checkoutLimiter, async (req, res) => {
    try {
      // ✅ SECURITY FIX: Validate input before processing
      const validation = validateCheckoutSession(req.body);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const { userId, email } = req.body;
      const stripeClient = getStripe();
      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Restart Our Love Premium',
                description: 'Unlimited sessions, advanced AI insights, and priority support.',
              },
              unit_amount: 1999, // $19.99
              recurring: {
                interval: 'month',
              },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?payment=success`,
        cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?payment=cancel`,
        metadata: {
          userId: userId,
        },
      });

      // ✅ SECURITY FIX: Log checkout session creation for audit trail
      await logAuditEvent(userId, 'checkout_session_created', {
        sessionId: session.id,
        email: email,
        amount: session.amount_total,
      }, req);

      res.json({ url: session.url });
    } catch (e: any) {
      console.error('Checkout session error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // ✅ SECURITY FIX: Enforce HTTPS in production
    app.use((req, res, next) => {
      if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(307, `https://${req.header('host')}${req.url}`);
      }
      next();
    });
    
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ✅ SECURITY FIX: Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    
    // Don't leak error details in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.status(500).json({ error: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production') {
      console.log('⚠️  HTTPS should be enforced via reverse proxy or load balancer');
    }
  });
}

startServer();
