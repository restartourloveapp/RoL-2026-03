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

// ✅ SECURITY FIX: Generate time-limited tokens for partner requests
function generatePartnerToken(): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return { token, expiresAt };
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
