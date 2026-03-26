import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import app, { 
  auth, db, storage
} from './firebase';
import AdminDashboard from './AdminDashboard';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  updateDoc,
  where,
  or,
  and,
  getDocFromServer,
  getDocs,
  limit,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { CRISIS_KEYWORDS, detectCrisis, getCrisisResources } from './services/safetyService';
import { 
  Heart, 
  MessageCircle, 
  Users, 
  Settings, 
  LogOut, 
  Shield, 
  Plus, 
  Send, 
  Lock, 
  User as UserIcon,
  ChevronRight,
  ShieldAlert,
  Sparkles,
  Paperclip,
  Info,
  CheckCircle,
  History,
  BookOpen,
  Calendar,
  Lightbulb,
  X,
  LifeBuoy,
  Phone,
  AlertTriangle,
  ExternalLink,
  Zap,
  Search,
  ShieldCheck,
  Trees,
  Save,
  Edit3,
  Trash2,
  Clock,
  Check,
  Link2,
  Loader,
  Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';
import * as Encryption from './services/encryption';
import * as AI from './services/ai';
import { AI_CONFIG } from './config/aiConfig';
import { Language, translations } from './services/i18n';
import { coaches, getCoachesList, getCoach, LOGO_IMAGES } from './config/coachData';

// --- Types ---
interface UserProfile {
  uid: string;
  profileId: string; // Unique ID for this person (independent of user account)
  email: string;
  displayName: string;
  photoURL: string;
  pinSalt: string;
  pinVerifier: string;
  wrappedCK: { ciphertext: string; iv: string };
  exchangePublicKey: string;
  wrappedExchangePrivateKey: { ciphertext: string; iv: string };
  wrappedRK?: { ciphertext: string; iv: string };
  subscriptionTier: 'free' | 'premium' | 'partner';
  partnerUid?: string;
  partnerId?: string; // Unique ID of the partner person
  role?: 'user' | 'admin' | 'partner';
  accountType?: 'own' | 'partner';
  mainAccountUid?: string;
  language?: Language;
  createdAt?: any;
  updatedAt?: any;
  profileName?: { ciphertext: string; iv: string };
  profilePronouns?: { ciphertext: string; iv: string };
  partnerName?: { ciphertext: string; iv: string };
  partnerPronouns?: { ciphertext: string; iv: string };
  defaultCoupleCoach?: AI.CoachPersona;
  personalCoach?: AI.CoachPersona;
  mainSharedDeviceFallback?: boolean;
}

interface ChatSession {
  id: string;
  type: 'personal' | 'couple';
  ownerUid: string; // User ID of account owner (for access control)
  partnerUid?: string; // Linked partner account UID for shared sessions
  ownerProfileId: string; // Profile ID of the person who owns this session
  partnerProfileId?: string; // Profile ID of the partner (for couple sessions)
  coachPersona: AI.CoachPersona;
  coachGender: AI.CoachGender;
  status: 'active' | 'archived' | 'closed' | 'beeindigd';
  createdAt: any;
  endedAt?: any;
  messageCount: number;
  wrappedSSK: { ciphertext: string; iv: string };
  partnerWrappedSSK?: { ciphertext: string; iv: string };
  lastCheckpointSummary?: { ciphertext: string; iv: string };
  summary?: { ciphertext: string; iv: string };
}

interface ChatMessage {
  id: string;
  senderUid: string; // User ID (for backward compatibility and encryption keys)
  senderProfileId?: string; // Profile ID (for identifying which person sent it in couple sessions)
  content: string;
  iv: string;
  createdAt: any;
  decryptedText?: string;
}

interface PartnerRequest {
  id: string;
  fromUid: string;
  fromEmail: string;
  code: string;
  respondentUid?: string;
  respondentEmail?: string;
  status: 'pending' | 'claimed' | 'accepted' | 'rejected';
  createdAt: any;
}

interface Homework {
  id: string;
  sessionId: string;
  ownerUid: string;
  partnerUid?: string;
  title: string;
  titleIv?: string;
  description: string;
  descriptionIv?: string;
  status: 'assigned' | 'completed' | 'skipped';
  dueDate?: { seconds: number };
  createdAt: { seconds: number };
  decryptedTitle?: string;
  decryptedDescription?: string;
}

interface TimelineEntry {
  id: string;
  sessionId: string;
  ownerUid: string;
  partnerUid?: string;
  title: string;
  titleIv?: string;
  description: string;
  descriptionIv?: string;
  type: 'milestone' | 'insight' | 'breakthrough';
  createdAt: { seconds: number };
  decryptedTitle?: string;
  decryptedDescription?: string;
}

interface CrisisResource {
  id: string;
  name: string;
  phone?: string;
  website?: string;
  description: string;
  category: string;
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center p-6 bg-stone-50 text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-2xl font-serif font-bold text-stone-900 mb-2">Something went wrong</h2>
          <p className="text-stone-500 max-w-md mb-6">
            An unexpected error occurred. This might be due to a connection issue or a security rule violation.
          </p>
          <pre className="bg-stone-100 p-4 rounded-xl text-[10px] text-left overflow-auto max-w-full mb-6">
            {JSON.stringify(this.state.error, null, 2)}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-stone-900 text-white rounded-xl font-bold"
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Main App Component ---
export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [language, setLanguage] = useState<Language>('nl');

  // Translation helper
  const t = (path: string, params?: Record<string, string>) => {
    const keys = path.split('.');
    let result: any = translations[language];
    for (const key of keys) {
      if (result[key] === undefined) return path;
      result = result[key];
    }
    if (typeof result === 'string' && params) {
      Object.entries(params).forEach(([key, value]) => {
        result = result.replaceAll(`{{${key}}}`, value);
      });
    }
    return result;
  };

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [preProfileChoice, setPreProfileChoice] = useState<'own' | 'partner' | null>(null);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [pin, setPin] = useState('');
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [kek, setKek] = useState<CryptoKey | null>(null);
  const [ck, setCk] = useState<CryptoKey | null>(null);
  const [exchangeKey, setExchangeKey] = useState<CryptoKey | null>(null);
  const [rk, setRk] = useState<CryptoKey | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionKeys, setSessionKeys] = useState<Record<string, CryptoKey>>({});
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [activeSSK, setActiveSSK] = useState<CryptoKey | null>(null);
  const [view, setView] = useState<'sessions' | 'settings' | 'timeline' | 'safety' | 'admin'>('sessions');
  const [timelineTab, setTimelineTab] = useState<'couple' | 'personal'>('couple');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [isCrisisDetected, setIsCrisisDetected] = useState(false);
  const [detectedCrisisKeyword, setDetectedCrisisKeyword] = useState<string | null>(null);

  // Profile Setup State
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profilePronounsInput, setProfilePronounsInput] = useState('');
  const [partnerNameInput, setPartnerNameInput] = useState('');
  const [partnerPronounsInput, setPartnerPronounsInput] = useState('');
  const [defaultCoachInput, setDefaultCoachInput] = useState<AI.CoachPersona>('solin');
  const [personalCoachInput, setPersonalCoachInput] = useState<AI.CoachPersona>('solin');
  const [setupStep, setSetupStep] = useState<0 | 1 | 2 | 3>(0);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // ✅ FEATURE: Partner Device Account State
  const [accountType, setAccountType] = useState<'own' | 'partner' | null>(null);
  const [partnerConnectionCode, setPartnerConnectionCode] = useState('');
  const [partnerConnectionCodeInput, setPartnerConnectionCodeInput] = useState('');
  const [generatedConnectionCode, setGeneratedConnectionCode] = useState<string | null>(null);
  const [connectionCodeExpiresAt, setConnectionCodeExpiresAt] = useState<Date | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isConnectingAsPartner, setIsConnectingAsPartner] = useState(false);
  const [connectionCodeError, setConnectionCodeError] = useState<string | null>(null);
  const [mainAccountEmail, setMainAccountEmail] = useState('');
  const [mainAccountPassword, setMainAccountPassword] = useState('');
  const [confirmedDataWipeout, setConfirmedDataWipeout] = useState(false);
  const [showPartnerDeviceSettings, setShowPartnerDeviceSettings] = useState(false);

  const [decryptedProfile, setDecryptedProfile] = useState<{
    name?: string;
    pronouns?: string;
    partnerName?: string;
    partnerPronouns?: string;
  }>({});
  const [sharedDeviceFallbackEnabled, setSharedDeviceFallbackEnabled] = useState(false);
  const [linkedAccountSummary, setLinkedAccountSummary] = useState<{
    linkedUid: string;
    linkedDisplayName: string;
    linkedEmail: string;
    relation: 'main-account' | 'partner-account';
  } | null>(null);

  const isAdmin = profile?.role === 'admin';
  const isPartnerAccount = profile?.accountType === 'partner' || profile?.role === 'partner' || !!profile?.mainAccountUid;
  const isMainAccount = !!profile && !isPartnerAccount;
  const hasLinkedPartnerDevice = !!profile?.partnerUid || !!profile?.mainAccountUid;
  const isSharedDeviceMode = !hasLinkedPartnerDevice || (isMainAccount && sharedDeviceFallbackEnabled);
  const isFreeTierAccount = !!profile && profile.subscriptionTier === 'free' && !isPartnerAccount;
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequest[]>([]);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkCodeInput, setLinkCodeInput] = useState('');
  const [isClaimingCode, setIsClaimingCode] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [crisisResources, setCrisisResources] = useState<CrisisResource[]>([]);

  const stats = useMemo(() => {
    if (!profile || (profile.subscriptionTier !== 'premium' && profile.subscriptionTier !== 'partner')) return null;
    
    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((acc, s) => acc + (s.messageCount || 0), 0);
    const milestones = timeline.filter(t => t.type === 'milestone').length;
    
    // Calculate days since profile creation
    const startTimestamp = profile.createdAt?.seconds || Date.now() / 1000;
    const daysJourney = Math.max(1, Math.ceil((Date.now() / 1000 - startTimestamp) / (24 * 3600)));
    
    return { totalSessions, totalMessages, milestones, daysJourney };
  }, [profile, sessions, timeline]);
  // Partner profiles are considered complete only after they are actually linked to a main account.
  const isProfileIncomplete = profile && !profile.profileName && !(profile.accountType === 'partner' && !!profile.mainAccountUid);
  const isUnlinkedPartnerFlow = !!profile && profile.accountType === 'partner' && !profile.mainAccountUid;
  const [newMessage, setNewMessage] = useState('');
  const [selectedSpeakerUid, setSelectedSpeakerUid] = useState<string | null>(null);
  const [expectedResponderProfileId, setExpectedResponderProfileId] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (activeSession && user && profile && !selectedSpeakerUid) {
      setSelectedSpeakerUid(profile.profileId);  // Always use profileId for proper attribution
    }
  }, [activeSession?.id, user?.uid, profile?.profileId]);

  useEffect(() => {
    setExpectedResponderProfileId(null);
  }, [activeSession?.id]);

  const resolveExpectedResponderProfileId = (
    nextSpeaker: 'user' | 'partner' | 'both' | 'none' | undefined,
    session?: ChatSession | null
  ) => {
    if (!session || session.type !== 'couple') return null;
    if (nextSpeaker === 'user') return session.ownerProfileId || null;
    if (nextSpeaker === 'partner') return session.partnerProfileId || null;
    return null;
  };

  const currentCoupleProfileId = activeSession?.type === 'couple'
    ? (isPartnerAccount
      ? (activeSession.partnerProfileId || profile?.profileId || null)
      : (activeSession.ownerProfileId || profile?.profileId || null))
    : (profile?.profileId || null);

  const currentCoupleName = activeSession?.type === 'couple'
    ? (isPartnerAccount
      ? (decryptedProfile?.partnerName || t('chat.you'))
      : (decryptedProfile?.name || t('chat.you')))
    : t('chat.you');

  const otherCoupleName = activeSession?.type === 'couple'
    ? (isPartnerAccount
      ? (decryptedProfile?.name || t('chat.partner'))
      : (decryptedProfile?.partnerName || t('chat.partner')))
    : t('chat.partner');

  const expectedResponderName = expectedResponderProfileId
    ? (expectedResponderProfileId === currentCoupleProfileId ? currentCoupleName : otherCoupleName)
    : null;

  const partnerDeviceMessagePlaceholder = activeSession?.type === 'couple' && !isSharedDeviceMode
    ? (expectedResponderProfileId && expectedResponderProfileId !== currentCoupleProfileId
      ? (language === 'nl'
        ? `Wachten op antwoord van '${expectedResponderName}'`
        : `Waiting for a response from '${expectedResponderName}'`)
      : (language === 'nl'
        ? `${currentCoupleName}, typ een bericht...`
        : `${currentCoupleName}, type a message...`))
    : null;

  const coupleMessagePlaceholder = activeSession?.type === 'couple'
    ? (isSharedDeviceMode
      ? `${selectedSpeakerUid === (activeSession.ownerProfileId || profile?.profileId)
        ? (decryptedProfile?.name || t('chat.you'))
        : (decryptedProfile?.partnerName || t('chat.partner'))}: ${t('sessions.messagePlaceholder')}`
      : (partnerDeviceMessagePlaceholder || t('sessions.messagePlaceholder')))
    : t('sessions.messagePlaceholder');

  // Restore partner onboarding step after refresh/reload while link is still pending.
  useEffect(() => {
    if (!profile) return;
    if (profile.accountType === 'partner' && !profile.mainAccountUid) {
      setAccountType('partner');
      if (setupStep !== 2) setSetupStep(2);
    }
  }, [profile?.uid, profile?.accountType, profile?.mainAccountUid]);

  useEffect(() => {
    if (!user || !isPinVerified || view !== 'settings' || (!profile?.partnerUid && !profile?.mainAccountUid)) {
      setLinkedAccountSummary(null);
      return;
    }

    let cancelled = false;
    const loadLinkedSummary = async () => {
      try {
        const fns = getFunctions(app, 'europe-west1');
        const callSummary = httpsCallable(fns, 'getLinkedAccountSummary');
        const result = await callSummary({});
        const data: any = result.data || {};
        if (!cancelled && data.success) {
          setLinkedAccountSummary({
            linkedUid: data.linkedUid,
            linkedDisplayName: data.linkedDisplayName || '',
            linkedEmail: data.linkedEmail || '',
            relation: data.relation === 'main-account' ? 'main-account' : 'partner-account',
          });
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('Failed to load linked account summary', e);
        }
      }
    };

    loadLinkedSummary();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, isPinVerified, view, profile?.partnerUid, profile?.mainAccountUid]);

  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [newSessionConfig, setNewSessionConfig] = useState<{
    type: 'personal' | 'couple';
    persona: AI.CoachPersona;
    gender: AI.CoachGender;
    personalSessionOwnerId?: string;
  }>({
    type: 'couple',
    persona: profile?.defaultCoupleCoach || 'solin',
    gender: 'female'
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const CoachIcon = ({ name, className }: { name: string, className?: string }) => {
    switch (name) {
      case 'Zap': return <Zap className={className} />;
      case 'Search': return <Search className={className} />;
      case 'ShieldCheck': return <ShieldCheck className={className} />;
      case 'Trees': return <Trees className={className} />;
      case 'Heart':
      default: return <Heart className={className} />;
    }
  };

  // --- Connection Test ---
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'crisis_resources', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // --- Auth & Profile ---
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      console.log("🔐 Auth state changed:", { uid: u?.uid, email: u?.email });
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        console.log("📖 Setting up Firestore listener for:", { path: `users/${u.uid}` });
        unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
          console.log("📖 Firestore snapshot received:", { exists: docSnap.exists(), uid: u.uid });
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            console.log("✅ User profile loaded:", { uid: data.uid, email: data.email });
            setProfile(data);
            if (data.language) setLanguage(data.language);
          } else {
            console.warn("⚠️ User document does not exist:", { uid: u.uid });
            setProfile(null);
          }
        }, (error) => {
          console.error("❌ Firestore read error:", {
            code: (error as any).code,
            message: error.message,
            uid: u.uid
          });
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        });
      } else {
        if (unsubscribeProfile) unsubscribeProfile();
        setProfile(null);
        setIsPinVerified(false);
        setKek(null);
        setCk(null);
        setPreProfileChoice(null);
      }
      setIsAuthReady(true);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  // --- Decrypt Profile Data ---
  useEffect(() => {
    if (!profile || !ck) return;

    const decryptProfile = async () => {
      try {
        const name = profile.profileName ? await Encryption.decryptText(profile.profileName, ck) : '';
        const pronouns = profile.profilePronouns ? await Encryption.decryptText(profile.profilePronouns, ck) : '';
        const partnerName = profile.partnerName ? await Encryption.decryptText(profile.partnerName, ck) : '';
        const partnerPronouns = profile.partnerPronouns ? await Encryption.decryptText(profile.partnerPronouns, ck) : '';

        // Backward compatibility: map old translated strings to keys
        const mapPronounsToKey = (val: string) => {
          if (['hij/hem', 'he/him'].includes(val)) return 'he';
          if (['zij/haar', 'she/her'].includes(val)) return 'she';
          if (['die/hen', 'they/them'].includes(val)) return 'they';
          if (['anders', 'other'].includes(val)) return 'other';
          return val;
        };

        const mappedPronouns = mapPronounsToKey(pronouns);
        const mappedPartnerPronouns = mapPronounsToKey(partnerPronouns);

        setDecryptedProfile({
          name,
          pronouns: mappedPronouns,
          partnerName,
          partnerPronouns: mappedPartnerPronouns
        });

        // For partner accounts, keep couple-level fields synced from main account updates.
        if (isPartnerAccount || !profileNameInput) setProfileNameInput(name);
        if (isPartnerAccount || !profilePronounsInput) setProfilePronounsInput(mappedPronouns);
        if (isPartnerAccount || !partnerNameInput) setPartnerNameInput(partnerName);
        if (isPartnerAccount || !partnerPronounsInput) setPartnerPronounsInput(mappedPartnerPronouns);
        if (profile.defaultCoupleCoach) {
          setDefaultCoachInput(profile.defaultCoupleCoach);
          setNewSessionConfig(prev => ({ ...prev, persona: profile.defaultCoupleCoach as AI.CoachPersona }));
        }
        if (profile.personalCoach) {
          setPersonalCoachInput(profile.personalCoach);
          // If the initial type is personal, set the persona to personalCoach
          setNewSessionConfig(prev => ({ 
            ...prev, 
            persona: prev.type === 'personal' ? (profile.personalCoach as AI.CoachPersona) : prev.persona 
          }));
        }
        if (!isPartnerAccount) {
          setSharedDeviceFallbackEnabled(Boolean(profile.mainSharedDeviceFallback));
        }
      } catch (e) {
        console.error("Failed to decrypt profile data", e);
      }
    };

    decryptProfile();
  }, [profile, ck, isPartnerAccount]);

  // --- Partner Settings Fallback Sync ---
  // If partner settings are stale, force a server-side sync when opening Settings.
  useEffect(() => {
    if (!user || !isPinVerified || !isPartnerAccount || view !== 'settings') return;

    let cancelled = false;

    const forceSync = async () => {
      try {
        const functions = getFunctions(app, 'europe-west1');
        const callSync = httpsCallable(functions, 'forcePartnerSettingsSync');
        await callSync({});
      } catch (error) {
        if (!cancelled) {
          console.error('Partner fallback sync failed:', error);
        }
      }
    };

    forceSync();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, isPinVerified, isPartnerAccount, view]);

  // --- Partner Request Listener ---
  useEffect(() => {
    if (!user || !isPinVerified || isAdmin) return;

    // Listen for requests where I am the creator (to see when partner claims my code)
    const q1 = query(
      collection(db, 'partner_requests'),
      where('fromUid', '==', user.uid),
      where('status', '==', 'claimed')
    );

    // Listen for requests where I claimed a code (to see acceptance)
    const q2 = query(
      collection(db, 'partner_requests'),
      where('respondentUid', '==', user.uid),
      where('status', '==', 'claimed')
    );

    const unsub1 = onSnapshot(q1, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PartnerRequest));
      setPartnerRequests(prev => {
        const otherReqs = prev.filter(r => r.fromUid !== user!.uid);
        return [...otherReqs, ...reqs];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'partner_requests');
    });

    const unsub2 = onSnapshot(q2, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PartnerRequest));
      setPartnerRequests(prev => {
        const otherReqs = prev.filter(r => r.respondentUid !== user!.uid);
        return [...otherReqs, ...reqs];
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'partner_requests');
    });

    return () => { unsub1(); unsub2(); };
  }, [user, isPinVerified, isAdmin]);

  // --- RK Derivation for Sender ---
  useEffect(() => {
    if (!user || !profile || !exchangeKey || !kek || profile.wrappedRK || !profile.partnerUid || isPartnerAccount) return;

    const deriveRK = async () => {
      try {
        const partnerSnap = await getDoc(doc(db, 'users', profile.partnerUid!));
        if (partnerSnap.exists()) {
          const partnerProfile = partnerSnap.data() as UserProfile;
          const remotePubKey = await Encryption.importPublicKey(partnerProfile.exchangePublicKey);
          const sharedSecret = await Encryption.deriveSharedSecret(exchangeKey, remotePubKey);
          const wrappedRk = await Encryption.wrapKey(sharedSecret, kek);
          
          await updateDoc(doc(db, 'users', user.uid), { wrappedRK: wrappedRk });
          setRk(sharedSecret);
        }
      } catch (e) {
        console.error("Auto-derivation of RK failed", e);
      }
    };

    deriveRK();
  }, [user, profile, exchangeKey, kek, isPartnerAccount]);

  // --- Session Listener ---
  useEffect(() => {
    if (!user || !isPinVerified) return;

    const q = query(
      collection(db, 'sessions'),
      or(
        where('ownerUid', '==', user.uid),
        where('partnerUid', '==', user.uid)
      ),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const s = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatSession));
      
      // Sort sessions: Active first, then Closed (most recent endedAt first)
      const sortedSessions = [...s].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        
        if ((a.status === 'closed' || a.status === 'beeindigd') && (b.status === 'closed' || b.status === 'beeindigd')) {
          const timeA = a.endedAt?.seconds || 0;
          const timeB = b.endedAt?.seconds || 0;
          return timeB - timeA;
        }
        
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      setSessions(sortedSessions);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sessions');
    });

    return unsubscribe;
  }, [user, isPinVerified]);

  // Update activeSession when sessions list changes to keep it fresh
  useEffect(() => {
    if (activeSession) {
      const updated = sessions.find(s => s.id === activeSession.id);
      if (updated && (
        updated.status !== activeSession.status || 
        updated.messageCount !== activeSession.messageCount ||
        updated.summary?.ciphertext !== activeSession.summary?.ciphertext
      )) {
        setActiveSession(updated);
      }
    }
  }, [sessions]);

  // --- Session Keys Unwrapping ---
  useEffect(() => {
    if (!sessions.length || !ck) return;

    const unwrapAllKeys = async () => {
      const newKeys: Record<string, CryptoKey> = { ...sessionKeys };
      let changed = false;

      for (const s of sessions) {
        if (newKeys[s.id]) continue;

        try {
          const isOwner = s.ownerUid === user?.uid;
          const wrappedData = isOwner ? s.wrappedSSK : s.partnerWrappedSSK;
          const wrappingKey = isOwner ? ck : rk;

          if (wrappedData && wrappingKey) {
            const ssk = await Encryption.unwrapKey(wrappedData, wrappingKey);
            newKeys[s.id] = ssk;
            changed = true;
          }
        } catch (e) {
          console.error(`Failed to unwrap SSK for session ${s.id}`, e);
        }
      }

      if (changed) {
        setSessionKeys(newKeys);
      }
    };

    unwrapAllKeys();
  }, [sessions, ck, rk, user]);

  // --- Timeline & Homework Listener ---
  useEffect(() => {
    if (!user || !isPinVerified) return;

    const qTimeline = query(
      collection(db, 'timeline'),
      or(where('ownerUid', '==', user.uid), where('partnerUid', '==', user.uid)),
      orderBy('createdAt', 'desc')
    );

    const qHomework = query(
      collection(db, 'homework'),
      or(where('ownerUid', '==', user.uid), where('partnerUid', '==', user.uid)),
      orderBy('createdAt', 'desc')
    );

    const unsubTimeline = onSnapshot(qTimeline, async (snap) => {
      const entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as TimelineEntry));
      
      // Decrypt entries
      const decryptedEntries = await Promise.all(entries.map(async (entry) => {
        const ssk = sessionKeys[entry.sessionId];
        if (!ssk || !entry.titleIv || !entry.descriptionIv) return entry;

        try {
          const title = await Encryption.decryptText({ ciphertext: entry.title, iv: entry.titleIv }, ssk);
          const description = await Encryption.decryptText({ ciphertext: entry.description, iv: entry.descriptionIv }, ssk);
          return { ...entry, decryptedTitle: title, decryptedDescription: description };
        } catch (e) {
          console.error("Failed to decrypt timeline entry", e);
          return entry;
        }
      }));

      setTimeline(decryptedEntries);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'timeline'));

    const unsubHomework = onSnapshot(qHomework, async (snap) => {
      const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() } as Homework));

      // Decrypt tasks
      const decryptedTasks = await Promise.all(tasks.map(async (task) => {
        const ssk = sessionKeys[task.sessionId];
        if (!ssk || !task.titleIv || !task.descriptionIv) return task;

        try {
          const title = await Encryption.decryptText({ ciphertext: task.title, iv: task.titleIv }, ssk);
          const description = await Encryption.decryptText({ ciphertext: task.description, iv: task.descriptionIv }, ssk);
          return { ...task, decryptedTitle: title, decryptedDescription: description };
        } catch (e) {
          console.error("Failed to decrypt homework task", e);
          return task;
        }
      }));

      setHomework(decryptedTasks);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'homework'));

    return () => {
      unsubTimeline();
      unsubHomework();
    };
  }, [user, isPinVerified, sessionKeys]);

  // --- Admin Tickets Listener (disabled - admin uses separate AdminDashboard) ---
  // Tickets are now loaded in AdminDashboard.tsx

  // --- Crisis Resources Listener ---
  useEffect(() => {
    const q = query(collection(db, 'crisis_resources'));
    const unsub = onSnapshot(q, (snap) => {
      setCrisisResources(snap.docs.map(d => ({ id: d.id, ...d.data() } as CrisisResource)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'crisis_resources');
    });
    return unsub;
  }, []);

  // --- Message Listener & Decryption ---
  useEffect(() => {
    if (!activeSession || !ck) {
      setActiveSSK(null);
      return;
    }

    const loadSessionKey = async () => {
      try {
        // Determine which wrapped SSK and wrapping key to use
        const isOwner = activeSession.ownerUid === user?.uid;
        const wrappedData = isOwner ? activeSession.wrappedSSK : activeSession.partnerWrappedSSK;
        const wrappingKey = isOwner ? ck : rk;

        if (!wrappedData) throw new Error("No wrapped SSK found for user");
        if (!wrappingKey) throw new Error("No wrapping key available");

        const ssk = await Encryption.unwrapKey(wrappedData, wrappingKey);
        setActiveSSK(ssk);
      } catch (e) {
        console.error("Failed to unwrap SSK", e);
        setActiveSSK(null);
      }
    };

    loadSessionKey();

    const q = query(
      collection(db, 'sessions', activeSession.id, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      setMessages(rawMessages); // We'll decrypt in the render or a separate effect
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `sessions/${activeSession.id}/messages`);
    });

    return unsubscribe;
  }, [activeSession, ck, rk, user?.uid]);

  // --- Decryption Effect ---
  useEffect(() => {
    if (messages.length === 0 || !activeSSK) return;

    const decryptAll = async () => {
      let crisisFound = false;
      let crisisKeyword = null;

      const decrypted = await Promise.all(messages.map(async (m) => {
        if (m.decryptedText) {
          if (detectCrisis(m.decryptedText)) {
            crisisFound = true;
            crisisKeyword = CRISIS_KEYWORDS.find(k => m.decryptedText!.toLowerCase().includes(k)) || null;
          }
          return m;
        }
        try {
          const text = await Encryption.decryptText(
            { ciphertext: m.content, iv: m.iv },
            activeSSK
          );
          if (detectCrisis(text)) {
            crisisFound = true;
            crisisKeyword = CRISIS_KEYWORDS.find(k => text.toLowerCase().includes(k)) || null;
          }
          return { ...m, decryptedText: text };
        } catch (e) {
          return { ...m, decryptedText: "[Encrypted Message]" };
        }
      }));
      
      if (crisisFound) {
        setIsCrisisDetected(true);
        setDetectedCrisisKeyword(crisisKeyword);
      }

      // Only update if something actually changed to avoid loops
      const hasChanges = decrypted.some((m, i) => m.decryptedText !== messages[i].decryptedText);
      if (hasChanges) {
        setMessages(decrypted);
      }
      scrollToBottom();
    };

    decryptAll();
  }, [messages, activeSSK]);

  // Reset crisis state when switching sessions
  useEffect(() => {
    setIsCrisisDetected(false);
    setDetectedCrisisKeyword(null);
  }, [activeSession]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // --- Handlers ---
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDescription, setSupportDescription] = useState('');
  const [includeSnippet, setIncludeSnippet] = useState(false);
  const [supportFile, setSupportFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleCreateTicket = async () => {
    if (!user || !supportSubject || !supportDescription) return;
    setIsUploading(true);
    try {
      let snippet = null;
      if (includeSnippet && activeSession && messages.length > 0) {
        snippet = messages.slice(-5).map(m => `${m.senderUid}: ${m.decryptedText}`).join('\n');
      }

      let fileUrl = null;
      if (supportFile) {
        const fileRef = ref(storage, `tickets/${user.uid}/${Date.now()}_${supportFile.name}`);
        await uploadBytes(fileRef, supportFile);
        fileUrl = await getDownloadURL(fileRef);
      }

      await addDoc(collection(db, 'tickets'), {
        userUid: user.uid,
        subject: supportSubject,
        description: supportDescription,
        plaintextSnippet: snippet,
        fileUrl,
        status: 'open',
        createdAt: serverTimestamp()
      });

      showToast(t('auth.alerts.ticketCreated'), 'success');
      setShowSupportModal(false);
      setSupportSubject('');
      setSupportDescription('');
      setIncludeSnippet(false);
      setSupportFile(null);
    } catch (e) {
      console.error("Failed to create ticket", e);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setAuthError(null);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      setAuthError(e.message);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAuthError(null);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(userCredential.user);
      setIsEmailSent(true);
      showToast(t('auth.alerts.verificationSent'), 'success');
    } catch (e: any) {
      setAuthError(e.message);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAuthError(null);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      if (!userCredential.user.emailVerified) {
        setAuthError(t('auth.alerts.emailNotVerified'));
        // Optionally resend verification
      }
    } catch (e: any) {
      setAuthError(e.message);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setIsEmailSent(false);
    setAuthError(null);
    setView('sessions');
    setActiveSession(null);
    setSetupStep(0);
    setAccountType(null);
    setPreProfileChoice(null);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (deleteAccountConfirmText.trim().toUpperCase() !== 'VERWIJDER') {
      showToast('Typ VERWIJDER om te bevestigen.', 'error');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data?.requiresRecentLogin) {
          showToast('Log opnieuw in en probeer daarna opnieuw te verwijderen.', 'error');
          await signOut(auth);
          return;
        }
        throw new Error(data?.error || 'Verwijderen mislukt');
      }

      if (data?.subscriptionNotice) {
        showToast(data.subscriptionNotice, 'info');
      }
      showToast(
        data?.deletedPartnerAccount
          ? 'Account, partneraccount en alle gekoppelde gegevens zijn verwijderd.'
          : 'Account en gegevens zijn verwijderd.',
        'success'
      );

      setShowDeleteAccountModal(false);
      setDeleteAccountConfirmText('');
      await signOut(auth);
    } catch (e) {
      console.error('Delete account failed:', e);
      showToast('Account kon niet worden verwijderd. Probeer opnieuw.', 'error');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleToggleSharedDeviceFallback = async () => {
    if (!user || !profile || isPartnerAccount || !profile.partnerUid) return;

    const nextValue = !sharedDeviceFallbackEnabled;
    setSharedDeviceFallbackEnabled(nextValue);

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        mainSharedDeviceFallback: nextValue,
        updatedAt: serverTimestamp()
      });
      showToast(nextValue ? 'Shared device fallback ingeschakeld' : 'Shared device fallback uitgeschakeld', 'success');
    } catch (e) {
      console.error('Failed to toggle shared device fallback', e);
      setSharedDeviceFallbackEnabled(!nextValue);
      showToast('Kon shared device fallback niet opslaan.', 'error');
    }
  };

  const handleSetupPin = async () => {
    // ✅ SECURITY FIX: PIN strength validation
    if (!user) return;

    // Partner accounts must inherit the main-account PIN and never create one locally.
    if (preProfileChoice === 'partner' || accountType === 'partner' || profile?.accountType === 'partner') {
      showToast('Partner account gebruikt de pincode van het hoofdaccount.', 'error');
      return;
    }
    
    // Enforce minimum PIN length of 6 digits
    if (!pin || pin.length < 6) {
      setAuthError('PIN must be at least 6 digits long');
      return;
    }
    
    // Verify PIN contains only digits (already filtered in input, but double-check)
    if (!/^\d+$/.test(pin)) {
      setAuthError('PIN must contain only digits');
      return;
    }
    
    // Warn if PIN is too weak (e.g., repeating digits like 111111)
    const uniqueDigits = new Set(pin).size;
    if (uniqueDigits === 1) {
      setAuthError('PIN is too weak. Use different digits.');
      return;
    }

    try {
      const salt = Encryption.generateSalt();
      const derivedKek = await Encryption.deriveKEK(pin, salt);
      const newCk = await Encryption.generateCK();
      const wrappedCk = await Encryption.wrapKey(newCk, derivedKek);
      const pinHash = await Encryption.hashPIN(pin, salt);

      // Generate Exchange Key Pair
      const exchangePair = await Encryption.generateExchangeKeyPair();
      const pubKeyB64 = await Encryption.exportPublicKey(exchangePair.publicKey);
      const wrappedPrivKey = await Encryption.exportPrivateKey(exchangePair.privateKey, derivedKek);

      // Generate unique profile ID (independent of user account)
      const profileId = crypto.randomUUID();
      const partnerId = crypto.randomUUID(); // Unique ID for the partner person

      const newProfile: UserProfile = {
        uid: user.uid,
        profileId,
        partnerId,
        email: user.email!,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        pinSalt: Encryption.b64Encode(salt),
        pinVerifier: pinHash,
        wrappedCK: wrappedCk,
        exchangePublicKey: pubKeyB64,
        wrappedExchangePrivateKey: wrappedPrivKey,
        subscriptionTier: 'free',
        language: 'nl',
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any
      };

      console.log('🔐 setupPin - User Auth:', { uid: user.uid, email: user.email });
      console.log('🔐 setupPin - Profile to save:', newProfile);
      console.log('🔐 setupPin - wrappedCK type:', typeof newProfile.wrappedCK, newProfile.wrappedCK);
      console.log('🔐 setupPin - wrappedExchangePrivateKey type:', typeof newProfile.wrappedExchangePrivateKey, newProfile.wrappedExchangePrivateKey);

      await setDoc(doc(db, 'users', user.uid), newProfile);
      setProfile(newProfile);
      setKek(derivedKek);
      setCk(newCk);
      setExchangeKey(exchangePair.privateKey);
      setIsPinVerified(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      showToast(t('auth.alerts.setupError'), 'error');
    }
  };

  const handleVerifyPin = async () => {
    if (!profile || pin.length < 4) return;

    try {
      const salt = Encryption.b64Decode(profile.pinSalt);
      const derivedKek = await Encryption.deriveKEK(pin, salt);
      const pinHash = await Encryption.hashPIN(pin, salt);

      if (pinHash !== profile.pinVerifier) {
        throw new Error("Incorrect PIN");
      }

      const unwrappedCk = await Encryption.unwrapKey(
        { ciphertext: profile.wrappedCK.ciphertext, iv: profile.wrappedCK.iv },
        derivedKek
      );

      const unwrappedExchangeKey = await Encryption.importPrivateKey(
        profile.wrappedExchangePrivateKey,
        derivedKek
      );

      if (profile.wrappedRK) {
        const unwrappedRk = await Encryption.unwrapKey(profile.wrappedRK, derivedKek);
        setRk(unwrappedRk);
      }

      setKek(derivedKek);
      setCk(unwrappedCk);
      setExchangeKey(unwrappedExchangeKey);
      setIsPinVerified(true);
    } catch (e) {
      showToast(t('auth.alerts.incorrectPin'), 'error');
    }
  };

  const handleSaveProfile = async () => {
    const isSavingAsPartner = accountType === 'partner' || isPartnerAccount;

    if (!user || (!ck && !isSavingAsPartner)) {
      console.error("Cannot save profile: user or ck is missing", { user: !!user, ck: !!ck });
      return;
    }
    setIsProfileSaving(true);
    try {
      const path = `users/${user.uid}`;

      if (isSavingAsPartner) {
        // For partner accounts we MUST NOT write empty encrypted profile fields.
        // Just record the account type + personal coach, then let the Cloud Function
        // push all shared fields (profileName, partnerName, keys, etc.) from the main account.
        const partnerUpdate: any = {
          accountType: 'partner',
          personalCoach: personalCoachInput,
          updatedAt: serverTimestamp()
        };
        await updateDoc(doc(db, 'users', user.uid), partnerUpdate);
        setNewSessionConfig(prev => ({ ...prev, persona: personalCoachInput }));

        // Immediately trigger the server-side sync so the profile is filled before we exit onboarding.
        try {
          const fns = getFunctions(app, 'europe-west1');
          const callSync = httpsCallable(fns, 'forcePartnerSettingsSync');
          await callSync({});
          showToast('Partner profiel gesynchroniseerd', 'success');
        } catch (syncErr) {
          console.warn('Immediate partner sync failed — will retry on next settings open', syncErr);
          showToast('Profiel opgeslagen. Partners data wordt zometeen gesynchroniseerd.', 'success');
        }

        // Partner account must unlock with the shared PIN after linking.
        setPreProfileChoice(null);
        setSetupStep(0);
        setIsPinVerified(false);
        setPin('');
      } else {
        const updateData: any = {
          personalCoach: personalCoachInput,
          updatedAt: serverTimestamp()
        };

        console.log("Encrypting profile data...");
        const encryptedName = await Encryption.encryptText(profileNameInput, ck);
        const encryptedPronouns = await Encryption.encryptText(profilePronounsInput, ck);
        const encryptedPartnerName = await Encryption.encryptText(partnerNameInput, ck);
        const encryptedPartnerPronouns = await Encryption.encryptText(partnerPronounsInput, ck);

        updateData.profileName = encryptedName;
        updateData.profilePronouns = encryptedPronouns;
        updateData.partnerName = encryptedPartnerName;
        updateData.partnerPronouns = encryptedPartnerPronouns;
        updateData.defaultCoupleCoach = defaultCoachInput;
        updateData.accountType = 'own';
        updateData.mainSharedDeviceFallback = sharedDeviceFallbackEnabled;

        console.log("Updating Firestore document:", path);
        try {
          await updateDoc(doc(db, 'users', user.uid), updateData);
          setNewSessionConfig(prev => ({ ...prev, persona: defaultCoachInput }));
        } catch (error) {
          console.error("Firestore update failed:", error);
          handleFirestoreError(error, OperationType.UPDATE, path);
        }

        setDecryptedProfile({
          name: profileNameInput,
          pronouns: profilePronounsInput,
          partnerName: partnerNameInput,
          partnerPronouns: partnerPronounsInput
        });

        showToast(t('settings.alerts.profileUpdated'), 'success');
      }
    } catch (e) {
      console.error("Failed to save profile:", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      // If it's a Firestore error (JSON string), try to parse it for better logging
      try {
        const parsed = JSON.parse(errorMessage);
        console.error("Parsed Firestore Error:", parsed);
      } catch {
        // Not a JSON error
      }
      showToast(t('settings.alerts.profileError'), 'error');
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleGenerateLinkCode = async () => {
    if (!user || !profile) return;
    if (isPartnerAccount || profile.subscriptionTier !== 'premium') {
      showToast(t('auth.alerts.premiumRequired'), 'error');
      return;
    }
    try {
      // Generate a random 6-char alphanumeric code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (0/O, 1/I/L)
      let code = '';
      const arr = new Uint8Array(6);
      crypto.getRandomValues(arr);
      for (let i = 0; i < 6; i++) code += chars[arr[i] % chars.length];

      await addDoc(collection(db, 'partner_requests'), {
        fromUid: user.uid,
        fromEmail: user.email || '',
        code,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setLinkCode(code);
      showToast(t('settings.codeCopied') || 'Code generated!', 'success');
    } catch (e) {
      console.error('Failed to generate link code', e);
    }
  };

  const handleClaimLinkCode = async () => {
    if (!user || !linkCodeInput.trim()) return;
    setIsClaimingCode(true);
    try {
      const code = linkCodeInput.trim().toUpperCase();
      const q = query(
        collection(db, 'partner_requests'),
        where('code', '==', code),
        where('status', '==', 'pending')
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        showToast(t('settings.invalidCode') || 'Invalid or expired code', 'error');
        setIsClaimingCode(false);
        return;
      }
      const reqDoc = snap.docs[0];
      const creatorSnap = await getDoc(doc(db, 'users', reqDoc.data().fromUid));
      if (!creatorSnap.exists() || (creatorSnap.data() as UserProfile).subscriptionTier !== 'premium') {
        showToast('Koppelen aan een gratis hoofdaccount is niet mogelijk.', 'error');
        setIsClaimingCode(false);
        return;
      }
      if (reqDoc.data().fromUid === user.uid) {
        showToast(t('settings.cannotLinkSelf') || 'Cannot link with yourself', 'error');
        setIsClaimingCode(false);
        return;
      }
      await updateDoc(doc(db, 'partner_requests', reqDoc.id), {
        respondentUid: user.uid,
        respondentEmail: user.email || '',
        status: 'claimed'
      });

      setLinkCodeInput('');
      showToast(t('settings.codeClaimed') || 'Code claimed! Waiting for approval...', 'success');
    } catch (e) {
      console.error('Failed to claim code', e);
      showToast(t('settings.codeClaimFailed') || 'Failed to claim code', 'error');
    } finally {
      setIsClaimingCode(false);
    }
  };

  const handleAcceptPartnerRequest = async (req: PartnerRequest) => {
    if (!user || !exchangeKey || !kek || !profile) return;
    if (isPartnerAccount || profile.subscriptionTier !== 'premium') {
      showToast('Partner koppelen is alleen beschikbaar voor de betaalde versie.', 'error');
      return;
    }
    try {
      const partnerUid = req.respondentUid;
      if (!partnerUid) {
        showToast('Partner request is incomplete (missing respondent).', 'error');
        return;
      }
      if (partnerUid === user.uid) {
        showToast('Cannot accept your own request as partner.', 'error');
        return;
      }

      // 1. Fetch partner public key (respondent account)
      const partnerSnap = await getDoc(doc(db, 'users', partnerUid));
      if (!partnerSnap.exists()) throw new Error("Partner profile not found");
      const partnerProfile = partnerSnap.data() as UserProfile;

      // 2. Derive Shared Secret (Relationship Key)
      const remotePubKey = await Encryption.importPublicKey(partnerProfile.exchangePublicKey);
      const sharedSecret = await Encryption.deriveSharedSecret(exchangeKey, remotePubKey);
      const wrappedRk = await Encryption.wrapKey(sharedSecret, kek);

      // 3. Update request status
      await updateDoc(doc(db, 'partner_requests', req.id), { status: 'accepted' });

      // 4. Store local main-account link material.
      // Cloud Function performs canonical cross-account sync.
      await updateDoc(doc(db, 'users', user.uid), { 
        partnerUid,
        wrappedRK: wrappedRk
      });

      setRk(sharedSecret);
      showToast(t('auth.alerts.partnerLinked'), 'success');
    } catch (e) {
      console.error("Failed to accept request", e);
    }
  };

  // ✅ FEATURE: Partner Device Account - Generate connection code
  const handleGeneratePartnerConnectionCode = async () => {
    if (!user || !profile) return;
    
    if (profile.subscriptionTier !== 'premium') {
      showToast(t('auth.alerts.premiumRequired'), 'error');
      return;
    }

    setIsGeneratingCode(true);
    try {
      const response = await fetch('/api/generate-partner-connection-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mainAccountUid: user.uid })
      });

      if (!response.ok) {
        const error = await response.json();
        showToast(error.error || 'Failed to generate code', 'error');
        return;
      }

      const data = await response.json();
      setGeneratedConnectionCode(data.code);
      setConnectionCodeExpiresAt(new Date(data.expiresAt));
      showToast('Connection code generated successfully', 'success');
    } catch (error) {
      console.error('Error generating connection code:', error);
      showToast('Failed to generate connection code', 'error');
    } finally {
      setIsGeneratingCode(false);
    }
  };

  // ✅ FEATURE: Partner Device Account - Connect device as partner
  const handleConnectAsPartnerDevice = async () => {
    if (!user || !profile || !kek) return;

    if (partnerConnectionCodeInput.length !== 6) {
      showToast('Connection code must be 6 characters', 'error');
      return;
    }

    setIsConnectingAsPartner(true);
    try {
      // Get PIN salt and verifier from current account
      // In real scenario, we'd get this from the main account,
      // but for now we use the current account's (which will be wiped and replaced)
      
      const response = await fetch('/api/connect-as-partner-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerAccountUid: user.uid,
          connectionCode: partnerConnectionCodeInput.toUpperCase(),
          pinSalt: profile.pinSalt,
          pinVerifier: profile.pinVerifier
        })
      });

      if (!response.ok) {
        const error = await response.json();
        showToast(error.error || 'Failed to connect as partner', 'error');
        return;
      }

      const data = await response.json();
      showToast('Successfully connected as partner device!', 'success');
      
      // Refresh profile to get updated data
      if (user) {
        const profileSnap = await getDoc(doc(db, 'users', user.uid));
        if (profileSnap.exists()) {
          const newProfile = profileSnap.data() as UserProfile;
          setProfile(newProfile);
          setPartnerConnectionCodeInput('');
        }
      }
      
      // Close the dialog/form
      setShowPartnerDeviceSettings(false);
    } catch (error) {
      console.error('Error connecting as partner device:', error);
      showToast('Failed to connect as partner device', 'error');
    } finally {
      setIsConnectingAsPartner(false);
    }
  };

  // ✅ FEATURE: Partner Device Account - Copy code to clipboard
  const handleCopyConnectionCode = async () => {
    if (!generatedConnectionCode) return;
    try {
      await navigator.clipboard.writeText(generatedConnectionCode);
      showToast('Code copied to clipboard', 'success');
    } catch (error) {
      console.error('Error copying code:', error);
      showToast('Failed to copy code', 'error');
    }
  };

  // ✅ FEATURE: Partner Device Account - Generate connection code
  const handleGenerateConnectionCode = async () => {
    if (!user || profile?.subscriptionTier !== 'premium') {
      showToast('Only premium accounts can generate partner connection codes', 'error');
      return;
    }

    setIsGeneratingCode(true);
    try {
      const response = await fetch('/api/generate-partner-connection-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainAccountUid: user.uid
        })
      });

      if (!response.ok) {
        const error = await response.json();
        showToast(error.error || 'Failed to generate code', 'error');
        return;
      }

      const data = await response.json();
      setGeneratedConnectionCode(data.code);
      setConnectionCodeExpiresAt(new Date(data.expiresAt));
      showToast('Connection code generated successfully', 'success');
    } catch (error) {
      console.error('Error generating connection code:', error);
      showToast('Failed to generate connection code', 'error');
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleCreateSession = async () => {
    if (!user || !ck || !profile?.profileId) return;

    const isStrictPartnerMode = hasLinkedPartnerDevice && !isSharedDeviceMode;
    if (
      newSessionConfig.type === 'personal' &&
      newSessionConfig.personalSessionOwnerId === 'partner' &&
      isStrictPartnerMode &&
      !isPartnerAccount
    ) {
      showToast('In partner mode moet de partner een persoonlijke sessie starten op het partner device.', 'error');
      return;
    }

    // Check free tier limit (max 3 sessions)
    if (isFreeTierAccount && sessions.length >= 3) {
      showToast(t('auth.alerts.freeLimitSessions'), 'error');
      handleUpgrade();
      return;
    }

    // Generate SSK for this session
    const ssk = await Encryption.generateCK();
    const wrappedSSK = await Encryption.wrapKey(ssk, ck);
    let partnerWrappedSSK = null;

    if (newSessionConfig.type === 'couple' && rk) {
      partnerWrappedSSK = await Encryption.wrapKey(ssk, rk);
    }

    // Determine owner profile ID
    let ownerProfileId = profile.profileId;
    let partnerProfileId: string | undefined;

    if (newSessionConfig.type === 'personal' && newSessionConfig.personalSessionOwnerId === 'partner') {
      // Personal session for partner
      ownerProfileId = profile.partnerId || profile.profileId;
    }
    
    // For couple sessions, always set both profile IDs
    if (newSessionConfig.type === 'couple') {
      partnerProfileId = profile.partnerId;
    }

    let canonicalOwnerUid = user.uid;
    let canonicalPartnerUid: string | undefined;

    if (newSessionConfig.type === 'couple') {
      const isPartnerDevice = profile.accountType === 'partner' && !!profile.mainAccountUid;
      if (isPartnerDevice && profile.mainAccountUid) {
        canonicalOwnerUid = profile.mainAccountUid;
        canonicalPartnerUid = user.uid;
        try {
          const mainSnap = await getDoc(doc(db, 'users', profile.mainAccountUid));
          if (mainSnap.exists()) {
            const mainProfile = mainSnap.data() as UserProfile;
            ownerProfileId = mainProfile.profileId || ownerProfileId;
            partnerProfileId = mainProfile.partnerId || partnerProfileId || profile.profileId;
          }
        } catch (e) {
          console.warn('Unable to load main profile for canonical session ownership', e);
        }
      } else {
        canonicalPartnerUid = profile.partnerUid;
      }
    }

    const sessionData: any = {
      type: newSessionConfig.type,
      ownerUid: canonicalOwnerUid, // Canonical owner for shared access control
      ownerProfileId,
      coachPersona: newSessionConfig.persona,
      coachGender: newSessionConfig.gender,
      status: 'active',
      createdAt: serverTimestamp(),
      messageCount: 0,
      wrappedSSK: wrappedSSK
    };

    // Set partner account/profile metadata for couple sessions
    if (canonicalPartnerUid) {
      sessionData.partnerUid = canonicalPartnerUid;
    }

    // Set partner profile ID for couple sessions
    if (partnerProfileId) {
      sessionData.partnerProfileId = partnerProfileId;
      if (partnerWrappedSSK) {
        sessionData.partnerWrappedSSK = partnerWrappedSSK;
      }
    }

    const sessionRef = await addDoc(collection(db, 'sessions'), sessionData);

    setShowNewSessionModal(false);
    const newSession = { id: sessionRef.id, ...sessionData, createdAt: new Date() } as ChatSession;
    setActiveSession(newSession);
    setActiveSSK(ssk);

    // Generate Welcome Message
    setIsAiLoading(true);
    try {
      const welcomeMessage = await AI.generateCoachResponse(
        newSession.coachPersona,
        newSession.coachGender,
        [], // Empty history for welcome
        "[SYSTEM]: Welcome the user(s) to this new session. Be warm and inviting.",
        language,
        decryptedProfile ? {
          userName: decryptedProfile.name,
          userPronouns: decryptedProfile.pronouns,
          partnerName: decryptedProfile.partnerName,
          partnerPronouns: decryptedProfile.partnerPronouns
        } : undefined,
        newSession.type === 'couple'
      );

      if (welcomeMessage && welcomeMessage.text) {
        const encryptedWelcome = await Encryption.encryptText(welcomeMessage.text, ssk);
        await addDoc(collection(db, 'sessions', sessionRef.id, 'messages'), {
          senderUid: 'ai_coach',
          content: encryptedWelcome.ciphertext,
          iv: encryptedWelcome.iv,
          createdAt: serverTimestamp(),
          role: 'assistant'
        });

        setExpectedResponderProfileId(resolveExpectedResponderProfileId(welcomeMessage.nextSpeaker, newSession));
      }
    } catch (e) {
      console.error("Failed to generate welcome message", e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!user) return;
    try {
      // Only allow deleting active sessions (per user request)
      const session = sessions.find(s => s.id === sessionId);
      if (!session || (session.status === 'closed' || session.status === 'beeindigd')) {
        showToast(t('sessions.alerts.cannotDeleteClosed'), 'error');
        setSessionToDelete(null);
        return;
      }

      // Delete session and its subcollections client-side
      const sessionRef = doc(db, 'sessions', sessionId);
      const batch = writeBatch(db);

      // Delete messages subcollection
      const messagesSnap = await getDocs(collection(db, 'sessions', sessionId, 'messages'));
      messagesSnap.forEach(d => batch.delete(d.ref));

      // Delete message_summaries subcollection
      const summariesSnap = await getDocs(collection(db, 'sessions', sessionId, 'message_summaries'));
      summariesSnap.forEach(d => batch.delete(d.ref));

      // Delete the session document itself
      batch.delete(sessionRef);
      await batch.commit();

      showToast(t('sessions.alerts.sessionDeleted'), 'success');
      setSessionToDelete(null);
      
      // If the deleted session was active, close it and return to dashboard
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setView('sessions');
      }
    } catch (e) {
      console.error("Failed to delete session", e);
      showToast(t('sessions.alerts.deletionFailed'), 'error');
      setSessionToDelete(null);
    }
  };

  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [sessionHomework, setSessionHomework] = useState<Array<{ title: string; description: string; dueDate?: string }>>([]);
  const [responseTip, setResponseTip] = useState<string | null>(null);
  const [isTipLoading, setIsTipLoading] = useState(false);

  const handleGetTip = async () => {
    if (!activeSession || messages.length === 0) return;
    setIsTipLoading(true);
    try {
      const history = messages.map(m => {
        let role: 'user' | 'model' = 'user';
        let content = m.decryptedText || '';
        if (m.senderUid === 'ai_coach') role = 'model';
        else if (m.senderUid === user!.uid) content = `[Me]: ${content}`;
        else content = `[Partner]: ${content}`;
        return { role, content };
      }).slice(-15);
      const tip = await AI.generateResponseTip(history, language);
      setResponseTip(tip);
    } catch (e) {
      console.error("Tip failed", e);
    } finally {
      setIsTipLoading(false);
    }
  };

  const handleSummary = async () => {
    if (!activeSession || !activeSSK) return;
    setIsSummaryLoading(true);
    try {
      // Close the session immediately to prevent further messages
      await updateDoc(doc(db, 'sessions', activeSession.id), {
        status: 'beeindigd',
        endedAt: serverTimestamp()
      });

      // Only generate summary if there are enough messages
      if (messages.length >= 3) {
        const history = messages.map(m => ({
          role: m.senderUid === user!.uid ? 'user' as const : 'model' as const,
          content: m.decryptedText || ''
        }));

        const filterExplicitHomework = (tasks: Array<{ title?: string; description?: string; dueDate?: string; evidence?: string }> = []) => {
          return tasks.reduce<Array<{ title: string; description: string; dueDate?: string; evidence?: string }>>((validTasks, task) => {
            const title = task.title?.trim();
            const description = task.description?.trim();
            const evidence = task.evidence?.trim();
            if (title && description && evidence && evidence.length >= 8) {
              validTasks.push({
                title,
                description,
                dueDate: task.dueDate,
                evidence
              });
            }
            return validTasks;
          }, []);
        };
        
        const isPremium = profile?.subscriptionTier === 'premium';
        const result = await AI.generateSummary(history, language, isPremium);
        const explicitHomework = filterExplicitHomework(result.homework || []);
        setSummary(result.summary);
        setSessionHomework(explicitHomework);

        // Save encrypted summary to session document
        const encryptedSummary = await Encryption.encryptText(result.summary, activeSSK);
        await updateDoc(doc(db, 'sessions', activeSession.id), {
          summary: {
            ciphertext: encryptedSummary.ciphertext,
            iv: encryptedSummary.iv
          }
        });

        // Open summary modal automatically
        setSummary(result.summary);

        const canonicalOwnerUid = activeSession.ownerUid || user!.uid;
        const canonicalPartnerUid = activeSession.type === 'couple'
          ? (
              activeSession.partnerUid ||
              (activeSession.ownerUid === user!.uid ? (profile?.partnerUid || null) : user!.uid)
            )
          : null;

        // Always save a Session Summary entry to the timeline for all users
        const summaryTitle = language === 'nl' ? 'Sessie Samenvatting' : 'Session Summary';
        const encryptedTimelineTitle = await Encryption.encryptText(summaryTitle, activeSSK);
        const encryptedTimelineDesc = await Encryption.encryptText(result.summary, activeSSK);
        
        await addDoc(collection(db, 'timeline'), {
          sessionId: activeSession.id,
          ownerUid: canonicalOwnerUid,
          partnerUid: canonicalPartnerUid,
          type: 'milestone',
          title: encryptedTimelineTitle.ciphertext,
          titleIv: encryptedTimelineTitle.iv,
          description: encryptedTimelineDesc.ciphertext,
          descriptionIv: encryptedTimelineDesc.iv,
          createdAt: serverTimestamp()
        });

        // Only save additional Timeline Entries for Premium users
        if (isPremium) {
          if (result.timelineEntries && result.timelineEntries.length > 0) {
            for (const entry of result.timelineEntries) {
              if (!entry.title || !entry.description) continue;
              const encryptedTitle = await Encryption.encryptText(entry.title, activeSSK);
              const encryptedDescription = await Encryption.encryptText(entry.description, activeSSK);
              await addDoc(collection(db, 'timeline'), {
                sessionId: activeSession.id,
                ownerUid: canonicalOwnerUid,
                partnerUid: canonicalPartnerUid,
                type: entry.type,
                title: encryptedTitle.ciphertext,
                titleIv: encryptedTitle.iv,
                description: encryptedDescription.ciphertext,
                descriptionIv: encryptedDescription.iv,
                createdAt: serverTimestamp()
              });
            }
          }
        }

        // Save Homework for ALL users (free & premium)
        if (explicitHomework.length > 0) {
          for (const task of explicitHomework) {
            if (!task.title || !task.description) continue;
            const encryptedTitle = await Encryption.encryptText(task.title, activeSSK);
            const encryptedDescription = await Encryption.encryptText(task.description, activeSSK);
            await addDoc(collection(db, 'homework'), {
              sessionId: activeSession.id,
              ownerUid: canonicalOwnerUid,
              partnerUid: canonicalPartnerUid,
              title: encryptedTitle.ciphertext,
              titleIv: encryptedTitle.iv,
              description: encryptedDescription.ciphertext,
              descriptionIv: encryptedDescription.iv,
              status: 'assigned',
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              createdAt: serverTimestamp()
            });

            // Also save homework as a timeline entry
            const homeworkTimelineTitle = language === 'nl' ? 'Huiswerkopdracht' : 'Homework Assignment';
            const encryptedHWTimelineTitle = await Encryption.encryptText(`${homeworkTimelineTitle}: ${task.title}`, activeSSK);
            const encryptedHWTimelineDesc = await Encryption.encryptText(task.description, activeSSK);
            await addDoc(collection(db, 'timeline'), {
              sessionId: activeSession.id,
              ownerUid: canonicalOwnerUid,
              partnerUid: canonicalPartnerUid,
              type: 'insight',
              title: encryptedHWTimelineTitle.ciphertext,
              titleIv: encryptedHWTimelineTitle.iv,
              description: encryptedHWTimelineDesc.ciphertext,
              descriptionIv: encryptedHWTimelineDesc.iv,
              createdAt: serverTimestamp()
            });
          }
        }

        // --- Session Meta-Summary Logic (Every 10 sessions) ---
        const archivedSessionsQuery = query(
          collection(db, 'sessions'),
          and(
            or(where('ownerUid', '==', user!.uid), where('partnerUid', '==', user!.uid)),
            where('status', 'in', ['archived', 'beeindigd'])
          ),
          orderBy('createdAt', 'desc')
        );
        const archivedSnap = await getDocs(archivedSessionsQuery);
        const archivedCount = archivedSnap.size;

        if (archivedCount > 0 && archivedCount % AI_CONFIG.SESSION_META_SUMMARY_INTERVAL === 0) {
          const lastSessions = archivedSnap.docs.slice(0, AI_CONFIG.SESSION_META_SUMMARY_INTERVAL);
          const summariesToMeta: string[] = [];
          
          for (const d of lastSessions) {
            const data = d.data();
            if (data.summary) {
              try {
                const wrappedSSK = data.ownerUid === user!.uid ? data.wrappedSSK : data.partnerWrappedSSK;
                if (wrappedSSK && ck) {
                  const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
                  const dec = await Encryption.decryptText({ ciphertext: data.summary.ciphertext, iv: data.summary.iv }, ssk);
                  summariesToMeta.push(dec);
                }
              } catch (e) { console.error("Failed to decrypt session summary for meta-summary", e); }
            }
          }

          if (summariesToMeta.length > 0) {
            const metaSummaryText = await AI.generateMetaSummary(summariesToMeta, language);
            if (metaSummaryText) {
              const encryptedMeta = await Encryption.encryptText(metaSummaryText, ck!);
              await addDoc(collection(db, 'users', user!.uid, 'session_meta_summaries'), {
                uid: user!.uid,
                ownerUid: canonicalOwnerUid,
                partnerUid: canonicalPartnerUid,
                sessionIds: lastSessions.map(s => s.id),
                startSessionIndex: archivedCount - AI_CONFIG.SESSION_META_SUMMARY_INTERVAL,
                endSessionIndex: archivedCount,
                ciphertext: encryptedMeta.ciphertext,
                iv: encryptedMeta.iv,
                createdAt: serverTimestamp()
              });
            }
          }
        }
      } else {
        // If not enough messages for a summary, just clear active session
        setActiveSession(null);
      }
    } catch (e) {
      console.error("Summary failed with error:", e);
      showToast(t('sessions.summaryError'), 'error');
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const handleUpgrade = async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, email: user.email }),
      });
      const { url } = await response.json();
      if (url) window.location.href = url;
    } catch (e) {
      console.error('Upgrade error:', e);
    }
  };

  const seedCrisisResources = async () => {
    const resources = [
      {
        name: "National Suicide Prevention Lifeline",
        phone: "988",
        website: "https://988lifeline.org",
        category: "suicide_prevention",
        description: "24/7, free and confidential support for people in distress."
      },
      {
        name: "Crisis Text Line",
        phone: "741741",
        website: "https://www.crisistextline.org",
        category: "general_crisis",
        description: "Free 24/7 support at your fingertips."
      },
      {
        name: "The Trevor Project",
        phone: "1-866-488-7386",
        website: "https://www.thetrevorproject.org",
        category: "lgbtq_support",
        description: "Crisis intervention and suicide prevention services to LGBTQ young people."
      }
    ];

    for (const r of resources) {
      await addDoc(collection(db, 'crisis_resources'), r);
    }
    showToast(t('auth.alerts.resourcesSeeded'), 'success');
  };

  const handleSendMessage = async () => {
    if (!activeSession || !activeSSK || !newMessage.trim()) return;

    // Free tier check
    if (isFreeTierAccount && activeSession.messageCount >= 40) {
      showToast(t('auth.alerts.freeLimit'), 'error');
      return;
    }

    const text = newMessage;
    setNewMessage('');

    try {
      // Encrypt message with SSK
      const encrypted = await Encryption.encryptText(text, activeSSK);

      const senderUid = user!.uid;
      let senderProfileId = profile?.profileId;

      // In shared sessions, sender identity is determined by account role/device,
      // not by the UI speaker toggle.
      if (activeSession.type === 'couple') {
        if (isSharedDeviceMode) {
          senderProfileId = selectedSpeakerUid || profile?.profileId;
        } else {
          const isPartnerDevice = profile?.accountType === 'partner' && !!profile?.mainAccountUid;
          if (isPartnerDevice) {
            senderProfileId = activeSession.partnerProfileId || profile?.profileId;
          } else {
            senderProfileId = activeSession.ownerProfileId || profile?.profileId;
          }
        }
      }

      await addDoc(collection(db, 'sessions', activeSession.id, 'messages'), {
        senderUid,
        senderProfileId,
        content: encrypted.ciphertext,
        iv: encrypted.iv,
        createdAt: serverTimestamp(),
        role: 'user'
      });

      // Update messageCount
      const newMessageCount = (activeSession.messageCount || 0) + 1;
      const sessionUpdate: any = { 
        messageCount: newMessageCount,
        lastMessageAt: serverTimestamp()
      };

      // --- Message Summary Logic (Every 20 messages) ---
      if (newMessageCount > 0 && newMessageCount % AI_CONFIG.MESSAGE_SUMMARY_INTERVAL === 0) {
        const historyToSummarize = messages.slice(-AI_CONFIG.MESSAGE_SUMMARY_INTERVAL).map(m => ({
          role: m.senderUid === 'ai_coach' ? 'model' as const : 'user' as const,
          content: m.decryptedText || ''
        }));
        const summaryText = await AI.generateMessageSummary(historyToSummarize, language);
        if (summaryText) {
          const encryptedMsgSummary = await Encryption.encryptText(summaryText, activeSSK);
          await addDoc(collection(db, 'sessions', activeSession.id, 'message_summaries'), {
            sessionId: activeSession.id,
            startMessageIndex: newMessageCount - AI_CONFIG.MESSAGE_SUMMARY_INTERVAL,
            endMessageIndex: newMessageCount,
            ciphertext: encryptedMsgSummary.ciphertext,
            iv: encryptedMsgSummary.iv,
            createdAt: serverTimestamp()
          });
        }
      }

      // --- Checkpoint Summary Logic (Every 10 messages for UI/Timeline) ---
      if (newMessageCount % 10 === 0) {
        // ... (existing checkpoint logic)
        const history = messages.map(m => ({
          role: m.senderUid === 'ai_coach' ? 'model' as const : 'user' as const,
          content: m.decryptedText || ''
        }));
        const isPremium = profile?.subscriptionTier === 'premium';
        const result = await AI.generateSummary(history, language, isPremium);
        const encryptedSummary = await Encryption.encryptText(result.summary, activeSSK);
        sessionUpdate.lastCheckpointSummary = {
          ciphertext: encryptedSummary.ciphertext,
          iv: encryptedSummary.iv
        };

        // Auto-extract timeline entries at checkpoints (Premium Only)
        if (isPremium) {
          if (result.timelineEntries && result.timelineEntries.length > 0) {
            for (const entry of result.timelineEntries) {
              if (!entry.title || !entry.description) continue;
              const encryptedTitle = await Encryption.encryptText(entry.title, activeSSK);
              const encryptedDescription = await Encryption.encryptText(entry.description, activeSSK);
              await addDoc(collection(db, 'timeline'), {
                sessionId: activeSession.id,
                ownerUid: activeSession.ownerUid || user!.uid,
                partnerUid: activeSession.type === 'couple' ? (activeSession.partnerUid || null) : null,
                type: entry.type,
                title: encryptedTitle.ciphertext,
                titleIv: encryptedTitle.iv,
                description: encryptedDescription.ciphertext,
                descriptionIv: encryptedDescription.iv,
                createdAt: serverTimestamp()
              });
            }
          }
        }

        // Note: Homework is NOT saved at checkpoints
        // Homework is only saved once when the session ends to avoid duplicates
      }

      await updateDoc(doc(db, 'sessions', activeSession.id), sessionUpdate);

      // --- Context Gathering for AI Response ---
      setIsAiLoading(true);
      
      const contextData: any = {
        messageSummaries: [],
        sessionSummaries: [],
        sharedPersonalSummaries: [],
        metaSummaries: [],
        lastHomework: null
      };

      // 1. Get Message Summaries for this session
      try {
        const msgSummariesSnap = await getDocs(collection(db, 'sessions', activeSession.id, 'message_summaries'));
        for (const d of msgSummariesSnap.docs) {
          const data = d.data();
          try {
            const dec = await Encryption.decryptText({ ciphertext: data.ciphertext, iv: data.iv }, activeSSK);
            contextData.messageSummaries.push(dec);
          } catch (e) {
            console.error("Failed to decrypt msg summary", e);
          }
        }
      } catch (e) {
        console.warn('[Context] Failed to load message summaries, continuing without them', e);
      }

      // 2. Get Recent Session Summaries (context depends on session type)
      // For PERSONAL sessions: only previous personal sessions from current user
      // For COUPLE sessions: only previous couple sessions
      
      console.debug(`[Context] Session type: ${activeSession.type}, fetching relevant previous sessions`);
      
      let recentSessions: Array<[string, any]> = [];

      try {
        if (activeSession.type === 'personal') {
          // PERSONAL SESSION: Only get previous personal sessions where current user is owner
          const personalQuery = query(
            collection(db, 'sessions'),
            where('ownerUid', '==', user!.uid),
            where('type', '==', 'personal'),
            orderBy('createdAt', 'desc'),
            limit(AI_CONFIG.MAX_RECENT_SESSION_SUMMARIES + 1)
          );
          
          const personalSnap = await getDocs(personalQuery);
          recentSessions = personalSnap.docs
            .map(d => [d.id, d.data()] as [string, any])
            .filter(([id]) => id !== activeSession.id);
          
          console.debug(`[Context] Personal session: Found ${recentSessions.length} previous personal sessions for current user`);
        } else {
          // COUPLE SESSION: Get previous couple sessions (from both owner and partner perspectives)
          const coupleOwnerQuery = query(
            collection(db, 'sessions'),
            where('ownerUid', '==', user!.uid),
            where('type', '==', 'couple'),
            orderBy('createdAt', 'desc'),
            limit(AI_CONFIG.MAX_RECENT_SESSION_SUMMARIES + 1)
          );
          
          const couplePartnerQuery = query(
            collection(db, 'sessions'),
            where('partnerUid', '==', user!.uid),
            where('type', '==', 'couple'),
            orderBy('createdAt', 'desc'),
            limit(AI_CONFIG.MAX_RECENT_SESSION_SUMMARIES + 1)
          );
          
          const [coupleOwnerSnap, couplePartnerSnap] = await Promise.all([
            getDocs(coupleOwnerQuery),
            getDocs(couplePartnerQuery)
          ]);
          
          const coupleSessions = new Map<string, any>();
          coupleOwnerSnap.docs.forEach(d => coupleSessions.set(d.id, d.data()));
          couplePartnerSnap.docs.forEach(d => coupleSessions.set(d.id, d.data()));
          
          recentSessions = Array.from(coupleSessions.entries())
            .filter(([id]) => id !== activeSession.id)
            .sort((a, b) => {
              const timeA = a[1].createdAt?.toMillis?.() || 0;
              const timeB = b[1].createdAt?.toMillis?.() || 0;
              return timeB - timeA;
            });
          
          console.debug(`[Context] Couple session: Found ${recentSessions.length} previous couple sessions`);
        }
      } catch (e) {
        console.warn('[Context] Failed to load recent session summaries, continuing without them', e);
      }

      // Load summaries from recent sessions
      for (const [sessionId, data] of recentSessions) {
        // Only process sessions with summaries
        if (!data.summary || !data.summary.ciphertext) {
          console.debug(`[Context] Session ${sessionId.slice(0, 6)}... has no summary, skipping`);
          continue;
        }

        try {
          const wrappedSSK = data.ownerUid === user!.uid ? data.wrappedSSK : data.partnerWrappedSSK;
          if (!wrappedSSK) {
            console.warn(`[Context] No wrapped SSK found for session ${sessionId.slice(0, 6)}...`);
            continue;
          }
          if (!ck) {
            console.warn(`[Context] No client key available for decryption`);
            continue;
          }

          const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
          const dec = await Encryption.decryptText(
            { ciphertext: data.summary.ciphertext, iv: data.summary.iv },
            ssk
          );
          contextData.sessionSummaries.push(dec);
          console.debug(`[Context] ✓ Loaded summary from session ${sessionId.slice(0, 6)}...`);
        } catch (e) {
          console.error(`[Context] Failed to decrypt session summary for ${sessionId.slice(0, 6)}...`, e);
        }
      }

      // 3. Get Shared Personal Summaries (COUPLE SESSIONS ONLY) - ONLY from timeline (explicit sharing)
      // CRITICAL: Personal sessions can ONLY be used as context if they appear in the couple's timeline
      // This ensures privacy: sessions are only included if BOTH partners explicitly shared them
      if (activeSession.type === 'couple') {
        try {
          console.debug(`[Context] Couple session detected - scanning timeline for shared personal sessions`);
          
          // Step 1: Find personal session entries in this couple's timeline (birth proof of sharing)
          const timelineQuery = query(
            collection(db, 'timeline'),
            where('ownerUid', '==', activeSession.ownerUid),
            where('type', 'in', ['milestone', 'insight']),
            orderBy('createdAt', 'desc'),
            limit(50)
          );
          
          const timelineSnap = await getDocs(timelineQuery);
          const sharedPersonalSessionIds = new Set<string>();
          
          for (const timelineDoc of timelineSnap.docs) {
            const timelineData = timelineDoc.data();
            const sessionId = timelineData.sessionId;
            
            if (!sessionId || sessionId === activeSession.id) {
              continue;
            }
            
            try {
              const refSession = await getDoc(doc(db, 'sessions', sessionId));
              if (refSession.exists() && refSession.data().type === 'personal') {
                sharedPersonalSessionIds.add(sessionId);
                console.debug(`[Context] Found shared personal session in timeline: ${sessionId.slice(0, 6)}...`);
              }
            } catch (e) {
              console.warn(`[Context] Could not verify session type for ${sessionId.slice(0, 6)}...`, e);
            }
          }
          
          console.debug(`[Context] Found ${sharedPersonalSessionIds.size} personal sessions in couple timeline`);
          
          for (const sharedSessionId of sharedPersonalSessionIds) {
            try {
              const sharedSession = await getDoc(doc(db, 'sessions', sharedSessionId));
              if (!sharedSession.exists()) {
                continue;
              }
              
              const sessionData = sharedSession.data();
              if (!sessionData.summary || !sessionData.summary.ciphertext) {
                continue;
              }
              
              const wrappedSSK = sessionData.ownerUid === user!.uid
                ? sessionData.wrappedSSK
                : sessionData.partnerWrappedSSK;
              
              if (!wrappedSSK || !ck) {
                console.warn(`[Context] Cannot decrypt shared personal session ${sharedSessionId.slice(0, 6)}...`);
                continue;
              }
              
              const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
              const dec = await Encryption.decryptText(
                { ciphertext: sessionData.summary.ciphertext, iv: sessionData.summary.iv },
                ssk
              );
              
              contextData.sharedPersonalSummaries.push(dec);
              console.debug(`[Context] ✓ Loaded SHARED personal session summary from ${sharedSessionId.slice(0, 6)}...`);
            } catch (e) {
              console.error(`[Context] Failed to load shared personal session ${sharedSessionId.slice(0, 6)}...`, e);
            }
          }
        } catch (e) {
          console.warn('[Context] Failed to scan timeline for shared personal sessions, continuing without them', e);
        }
      }

      // 4. Get Meta Summaries (last 10)
      try {
        const metaSnap = await getDocs(query(
          collection(db, 'users', user!.uid, 'session_meta_summaries'),
          orderBy('createdAt', 'desc'),
          limit(10)
        ));
        for (const d of metaSnap.docs) {
          const data = d.data();
          try {
            const dec = await Encryption.decryptText({ ciphertext: data.ciphertext, iv: data.iv }, ck!);
            contextData.metaSummaries.push(dec);
          } catch (e) {
            console.error("Failed to decrypt meta summary", e);
          }
        }
      } catch (e) {
        console.warn('[Context] Failed to load meta summaries, continuing without them', e);
      }

      // 5. Get Pending Homework (all unfinished homework for follow-up check)
      console.debug(`[Context] Fetching pending homework for user ${user!.uid.slice(0, 6)}...`);
      
      // Get homework where current user is owner
      const pendingHomework: Array<{ title: string; description: string; dueDate?: string }> = [];
      try {
        const hwOwnerSnap = await getDocs(query(
          collection(db, 'homework'),
          where('ownerUid', '==', user!.uid),
          where('status', '==', 'assigned'),
          orderBy('createdAt', 'desc'),
          limit(10)
        ));
        
        const hwPartnerSnap = await getDocs(query(
          collection(db, 'homework'),
          where('partnerUid', '==', user!.uid),
          where('status', '==', 'assigned'),
          orderBy('createdAt', 'desc'),
          limit(10)
        ));
        
        const hwDocs = [...hwOwnerSnap.docs, ...hwPartnerSnap.docs];
        
        console.debug(`[Context] Found ${hwDocs.length} pending homework items`);
        
        for (const hwDoc of hwDocs) {
          const data = hwDoc.data();
          try {
            const hwSessionDoc = await getDoc(doc(db, 'sessions', data.sessionId));
            if (!hwSessionDoc.exists()) {
              console.warn(`[Context] Homework references non-existent session ${data.sessionId.slice(0, 6)}...`);
              continue;
            }
            
            const hwSessionData = hwSessionDoc.data();
            const wrappedSSK = hwSessionData.ownerUid === user!.uid ? hwSessionData.wrappedSSK : hwSessionData.partnerWrappedSSK;
            
            if (!wrappedSSK) {
              console.warn(`[Context] No wrapped SSK for homework in session ${data.sessionId.slice(0, 6)}...`);
              continue;
            }
            if (!ck) {
              console.warn(`[Context] No client key available for homework decryption`);
              continue;
            }
            
            const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
            const title = await Encryption.decryptText({ ciphertext: data.title, iv: data.titleIv }, ssk);
            const desc = await Encryption.decryptText({ ciphertext: data.description, iv: data.descriptionIv }, ssk);
            
            pendingHomework.push({
              title,
              description: desc,
              dueDate: data.dueDate?.toDate?.().toISOString()
            });
            
            console.debug(`[Context] ✓ Loaded homework: "${title}"`);
          } catch (e) {
            console.error(`[Context] Failed to decrypt homework from session ${data.sessionId.slice(0, 6)}...`, e);
          }
        }
      } catch (e) {
        console.warn('[Context] Failed to load pending homework, continuing without it', e);
      }
      
      console.debug(`[Context] Successfully loaded ${pendingHomework.length} homework items`);
      
      if (pendingHomework.length > 0) {
        contextData.pendingHomework = pendingHomework.map(hw => 
          `- **${hw.title}**: ${hw.description}${hw.dueDate ? ` (Due: ${new Date(hw.dueDate).toLocaleDateString(language === 'nl' ? 'nl-NL' : 'en-US')})` : ''}`
        );
        // Also keep lastHomework for backward compatibility
        contextData.lastHomework = `${pendingHomework[0].title}: ${pendingHomework[0].description}`;
      }

      // --- AI Response Generation ---
      const history = messages.map(m => {
        let role: 'user' | 'model' = 'user';
        let content = m.decryptedText || '';
        
        if (m.senderUid === 'ai_coach') {
          role = 'model';
        } else if (m.senderProfileId === profile?.profileId || (m.senderUid === user!.uid && !m.senderProfileId)) {
          // Current profile or user account (backward compatibility)
          role = 'user';
          content = `[Me]: ${content}`;
        } else {
          // Partner profile
          role = 'user';
          content = `[Partner]: ${content}`;
        }
        
        return { role, content };
      }).slice(-AI_CONFIG.MAX_FULL_MESSAGES);

      // Check if this is the FIRST message in the session (welcome message)
      const isFirstMessage = messages.filter(m => m.senderUid === 'ai_coach').length === 0;
      
      let aiResult;
      if (isFirstMessage) {
        // Generate a warm welcome message that includes previous session summary and homework check
        console.debug(
          `[Welcome] Generating welcome message for ${activeSession.type} session:`,
          {
            prevSessionSummaries: contextData.sessionSummaries.length,
            sharedPersonalSummaries: activeSession.type === 'couple' ? contextData.sharedPersonalSummaries.length : 0,
            pendingHomework: contextData.pendingHomework?.length || 0
          }
        );
        
        // Build profile context based on session type
        let profileContext: any = undefined;
        if (activeSession.type === 'personal' && decryptedProfile) {
          // PERSONAL: Only include current user's profile
          profileContext = {
            userName: decryptedProfile.name,
            userPronouns: decryptedProfile.pronouns
          };
          console.debug(`[Welcome] Personal session: Using only current user profile`);
        } else if (activeSession.type === 'couple' && decryptedProfile) {
          // COUPLE: Include both user and partner names
          profileContext = {
            userName: decryptedProfile.name,
            userPronouns: decryptedProfile.pronouns,
            partnerName: decryptedProfile.partnerName,
            partnerPronouns: decryptedProfile.partnerPronouns
          };
          console.debug(`[Welcome] Couple session: Using both profiles`);
        }
        
        aiResult = await AI.generateSessionWelcome(
          activeSession.coachPersona,
          activeSession.coachGender,
          language,
          profileContext,
          activeSession.type === 'couple',
          {
            sessionSummaries: contextData.sessionSummaries,
            sharedPersonalSummaries: contextData.sharedPersonalSummaries,
            pendingHomework: contextData.pendingHomework,
            lastHomework: contextData.lastHomework
          }
        );
        
        console.debug(`[Welcome] ✓ Welcome message generated (${aiResult.text?.slice(0, 80)}...)`);
      } else {
        // Normal conversation flow
        aiResult = await AI.generateCoachResponse(
          activeSession.coachPersona,
          activeSession.coachGender,
          history,
          text,
          language,
          decryptedProfile ? {
            userName: decryptedProfile.name,
            userPronouns: decryptedProfile.pronouns,
            partnerName: decryptedProfile.partnerName,
            partnerPronouns: decryptedProfile.partnerPronouns
          } : undefined,
          activeSession.type === 'couple',
          contextData
        );
      }

      if (aiResult && aiResult.text) {
        const encryptedAi = await Encryption.encryptText(aiResult.text, activeSSK);
        await addDoc(collection(db, 'sessions', activeSession.id, 'messages'), {
          senderUid: 'ai_coach',
          content: encryptedAi.ciphertext,
          iv: encryptedAi.iv,
          createdAt: serverTimestamp(),
          role: 'assistant'
        });

        const nextResponderProfileId = resolveExpectedResponderProfileId(aiResult.nextSpeaker, activeSession);
        setExpectedResponderProfileId(nextResponderProfileId);

        // Auto-select next speaker in couple sessions
        if (activeSession.type === 'couple' && isSharedDeviceMode && aiResult.nextSpeaker) {
          console.log('DEBUG: Condition met, setting nextSpeaker:', aiResult.nextSpeaker);
          if (aiResult.nextSpeaker === 'user') {
            console.log('DEBUG: Setting speaker to current profile:', profile?.profileId);
            setSelectedSpeakerUid(profile?.profileId || user!.uid);
          } else if (aiResult.nextSpeaker === 'partner') {
            // Determine partner profile ID from activeSession
            let partnerProfileId: string | undefined;
            
            // In the session, ownerProfileId is one person, partnerProfileId is the other
            // We need to select the one that's not currently speaking
            if (profile?.profileId === activeSession.ownerProfileId) {
              // Current profile is owner -> select partner
              partnerProfileId = activeSession.partnerProfileId;
              console.log('DEBUG: Current profile is owner, selecting partner profile:', partnerProfileId);
            } else {
              // Current profile is partner -> select owner
              partnerProfileId = activeSession.ownerProfileId;
              console.log('DEBUG: Current profile is partner, selecting owner profile:', partnerProfileId);
            }
            
            if (partnerProfileId) {
              console.log('DEBUG: Setting speaker to partner profile:', partnerProfileId);
              setSelectedSpeakerUid(partnerProfileId);
            } else {
              console.warn('DEBUG: Could not determine partner profile ID');
            }
          }
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `sessions/${activeSession.id}/messages`);
    } finally {
      setIsAiLoading(false);
    }
  };

  // --- Render Helpers ---
  if (!isAuthReady) return <div className="h-screen flex items-center justify-center bg-stone-50"><motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity }}><Heart className="w-12 h-12 text-emerald-500 fill-emerald-500" /></motion.div></div>;

  // Admin users get a separate dashboard - no PIN, no user UI
  if (user && isAdmin) {
    return <AdminDashboard userEmail={user.email || ''} />;
  }

  if (!user || (user.providerData.some(p => p.providerId === 'password') && !user.emailVerified)) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full space-y-8">
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mb-6">
              <Heart className="w-10 h-10 text-emerald-600 fill-emerald-600" />
            </div>
            <h1 className="text-4xl font-serif font-bold text-stone-900">
              {isEmailSent ? t('auth.verifyEmailTitle') : (authMode === 'login' ? t('auth.loginTitle') : t('auth.signupTitle'))}
            </h1>
            <p className="mt-4 text-stone-600 font-serif italic text-lg">
              {isEmailSent ? t('auth.verifyEmailSubtitle') : t('auth.loginSubtitle')}
            </p>
          </div>
          
          {isEmailSent ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-emerald-800 text-sm">
                {t('auth.emailSentMessage')} {email}
              </div>
              <button 
                onClick={() => { setIsEmailSent(false); setAuthMode('login'); signOut(auth); }}
                className="w-full py-4 rounded-2xl font-medium text-stone-600 hover:bg-stone-100 transition-colors"
              >
                {t('auth.backToLogin')}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <form onSubmit={authMode === 'login' ? handleEmailSignIn : handleEmailSignUp} className="space-y-4">
                <div className="space-y-2">
                  <input
                    type="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  />
                  <input
                    type="password"
                    placeholder={t('auth.passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                {authError && (
                  <div className="text-red-500 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
                    {authError}
                  </div>
                )}

                <button 
                  type="submit"
                  className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-medium hover:bg-emerald-700 transition-colors shadow-lg"
                >
                  {authMode === 'login' ? t('auth.loginButton') : t('auth.signupButton')}
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-stone-200"></div></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-stone-50 px-2 text-stone-400">{t('auth.orContinueWith')}</span></div>
              </div>

              <button 
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white border border-stone-200 text-stone-900 py-4 rounded-2xl font-medium hover:bg-stone-50 transition-colors shadow-sm"
              >
                <UserIcon className="w-5 h-5" />
                {t('auth.googleLoginButton')}
              </button>

              <button 
                onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }}
                className="text-emerald-600 font-medium hover:underline"
              >
                {authMode === 'login' ? t('auth.noAccountLink') : t('auth.hasAccountLink')}
              </button>

              <div className="flex items-center gap-2 justify-center text-stone-400 text-sm">
                <Shield className="w-4 h-4" />
                <span>{t('auth.zeroKnowledge')}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-8">
            <div className="p-4 bg-white rounded-2xl border border-stone-200 text-left">
              <ShieldAlert className="w-6 h-6 text-emerald-600 mb-2" />
              <h3 className="font-bold text-stone-900 text-sm">{t('auth.safeSpaceTitle')}</h3>
              <p className="text-xs text-stone-500">{t('auth.safeSpaceSubtitle')}</p>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-stone-200 text-left">
              <Sparkles className="w-6 h-6 text-emerald-600 mb-2" />
              <h3 className="font-bold text-stone-900 text-sm">{t('auth.aiCoachingTitle')}</h3>
              <p className="text-xs text-stone-500">{t('auth.aiCoachingSubtitle')}</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // New users must choose account flow before PIN setup.
  if (user && !profile && !preProfileChoice) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full space-y-8">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="font-serif font-bold text-3xl text-stone-900">Hoe wil je starten?</h1>
            <p className="text-stone-500">Kies eerst of je een nieuw profiel maakt of koppelt met je partner.</p>
          </div>

          <div className="space-y-4 bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
            <button
              onClick={() => {
                setPreProfileChoice('own');
                setAccountType('own');
                setSetupStep(1);
              }}
              className="w-full p-6 text-left border-2 border-stone-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all space-y-2"
            >
              <h3 className="font-bold text-lg text-stone-900">Nieuw profiel aanmaken</h3>
              <p className="text-sm text-stone-500">Maak eerst je pincode aan en stel daarna je profiel in.</p>
            </button>

            <button
              onClick={async () => {
                if (!user) return;
                if (!user.email) {
                  showToast('Geen e-mailadres gevonden voor dit account.', 'error');
                  return;
                }
                try {
                  await setDoc(doc(db, 'users', user.uid), {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || 'Anonymous',
                    photoURL: user.photoURL || '',
                    subscriptionTier: 'partner',
                    language: 'nl',
                    accountType: 'partner',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  }, { merge: true });

                  setPreProfileChoice('partner');
                  setAccountType('partner');
                  setSetupStep(2);
                  setIsPinVerified(true);
                } catch (e) {
                  console.error('Failed to initialize partner profile shell', e);
                  showToast('Kon partner-flow niet starten. Probeer opnieuw.', 'error');
                }
              }}
              className="w-full p-6 text-left border-2 border-stone-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all space-y-2"
            >
              <h3 className="font-bold text-lg text-stone-900">Koppelen aan partner-account</h3>
              <p className="text-sm text-stone-500">Verbind met een code van je partner. Je hoeft nu nog geen pincode te maken.</p>
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (user && !profile && preProfileChoice === 'partner') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200 text-center space-y-4">
          <Loader className="w-8 h-8 mx-auto text-emerald-600 animate-spin" />
          <p className="text-stone-700">Partner-profiel wordt voorbereid...</p>
        </div>
      </div>
    );
  }

  if (!isPinVerified && preProfileChoice !== 'partner' && !isUnlinkedPartnerFlow) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-sm w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-stone-900" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-stone-900">
              {profile ? t('auth.pinTitle') : t('auth.pinSetupTitle')}
            </h2>
            <p className="text-stone-500 text-sm mt-2">
              {profile 
                ? t('auth.pinSubtitle') 
                : t('auth.pinSetupSubtitle')}
            </p>
          </div>

          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.length < 6) return;
              if (profile) {
                handleVerifyPin();
              } else {
                handleSetupPin();
              }
            }}
          >
            <div>
              <input 
                type="text"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="••••••"
                className="w-full text-center text-4xl tracking-widest py-4 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none transition-colors"
                style={{ WebkitTextSecurity: 'disc' } as any}
              />
              {/* ✅ SECURITY FIX: Show PIN strength feedback */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-stone-500">
                  {pin.length}/6 {pin.length < 6 ? '(minimum 6 digits)' : ''}
                </span>
                {pin.length >= 6 && (
                  <span className="text-emerald-600 flex items-center">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Strength: OK
                  </span>
                )}
              </div>
            </div>
            <button 
              type="submit"
              disabled={pin.length < 6}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {profile ? t('auth.unlockButton') : t('auth.initButton')}
            </button>
            <p className="text-center text-[10px] text-stone-400 uppercase tracking-widest font-bold">
              <Shield className="inline w-3 h-3 mr-1" />
              {t('auth.zeroKnowledge')}
            </p>
          </form>
        </motion.div>
      </div>
    );
  }

  if (isProfileIncomplete) {
    return (
      <div className="h-screen bg-stone-50 flex flex-col p-6 overflow-y-auto pt-safe pb-safe">
        {/* Progress Indicator */}
        {accountType && (
          <div className="mb-8 max-w-md mx-auto w-full">
            <div className="flex items-center justify-between text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">
              <span>Setup Progress</span>
              <span>
                {accountType === 'own' ? (
                  setupStep === 1 ? '1 of 2' : setupStep === 2 ? '2 of 2' : ''
                ) : (
                  setupStep === 2 ? '1 of 2' : setupStep === 3 ? '2 of 2' : ''
                )}
              </span>
            </div>
            <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ 
                  width: accountType === 'own' 
                    ? (setupStep === 1 ? '50%' : '100%')
                    : (setupStep === 2 ? '50%' : '100%')
                }}
              />
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {/* ✅ FEATURE: Partner Device Account - Account Type Selection */}
          {!accountType ? (
            <motion.div 
              key="accountType"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-md mx-auto w-full space-y-8 py-12"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-emerald-600" />
                </div>
                <h1 className="font-serif font-bold text-3xl text-stone-900">How to get started?</h1>
                <p className="text-stone-500">Choose how you want to use Restart Our Love</p>
              </div>

              <div className="space-y-4 bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                <button
                  onClick={() => {
                    setAccountType('own');
                    setSetupStep(1);
                  }}
                  className="w-full p-6 text-left border-2 border-stone-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all space-y-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-lg text-stone-900">Create My Own Account</h3>
                      <p className="text-sm text-stone-500">Set up your personal coaching space</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-stone-400 group-hover:text-emerald-600 transition-colors" />
                  </div>
                  <ul className="text-xs text-stone-600 space-y-1">
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Personal coaching sessions
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Later connect with partner on another device
                    </li>
                  </ul>
                </button>

                <button
                  onClick={() => {
                    setAccountType('partner');
                    setSetupStep(2);
                  }}
                  className="w-full p-6 text-left border-2 border-stone-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all space-y-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-lg text-stone-900">Connect to Partner's Account</h3>
                      <p className="text-sm text-stone-500">Use this device with an existing account</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-stone-400 group-hover:text-emerald-600 transition-colors" />
                  </div>
                  <ul className="text-xs text-stone-600 space-y-1">
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Use connection code from partner
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Same PIN as main account
                    </li>
                  </ul>
                </button>
              </div>
            </motion.div>
          ) : setupStep === 1 && accountType === 'own' ? (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-md mx-auto w-full space-y-8 py-12"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
                  <UserIcon className="w-8 h-8 text-emerald-600" />
                </div>
                <h1 className="font-serif font-bold text-3xl text-stone-900">{t('profile.setupTitle')}</h1>
                <p className="text-stone-500">{t('profile.setupSubtitle')}</p>
              </div>

              <div className="space-y-6 bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('profile.yourName')}</label>
                    <input 
                      type="text"
                      value={profileNameInput}
                      onChange={(e) => setProfileNameInput(e.target.value)}
                      placeholder="e.g. Alex"
                      className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-col">
                      <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('profile.yourPronouns')}</label>
                      <span className="text-[10px] text-stone-400 italic">{t('profile.yourPronounsDesc')}</span>
                    </div>
                    <select 
                      value={profilePronounsInput}
                      onChange={(e) => setProfilePronounsInput(e.target.value)}
                      className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none appearance-none"
                    >
                      <option value="">{t('common.select')}</option>
                      <option value="he">{t('profile.pronounsOptions.he')}</option>
                      <option value="she">{t('profile.pronounsOptions.she')}</option>
                      <option value="they">{t('profile.pronounsOptions.they')}</option>
                      <option value="other">{t('profile.pronounsOptions.other')}</option>
                    </select>
                  </div>
                </div>

                <div className="h-px bg-stone-100" />

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('profile.partnerName')}</label>
                    <input 
                      type="text"
                      value={partnerNameInput}
                      onChange={(e) => setPartnerNameInput(e.target.value)}
                      placeholder="e.g. Sam"
                      className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-col">
                      <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('profile.partnerPronouns')}</label>
                      <span className="text-[10px] text-stone-400 italic">{t('profile.partnerPronounsDesc')}</span>
                    </div>
                    <select 
                      value={partnerPronounsInput}
                      onChange={(e) => setPartnerPronounsInput(e.target.value)}
                      className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none appearance-none"
                    >
                      <option value="">{t('common.select')}</option>
                      <option value="he">{t('profile.pronounsOptions.he')}</option>
                      <option value="she">{t('profile.pronounsOptions.she')}</option>
                      <option value="they">{t('profile.pronounsOptions.they')}</option>
                      <option value="other">{t('profile.pronounsOptions.other')}</option>
                    </select>
                  </div>
                </div>

                <div className="h-px bg-stone-100" />

                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setAccountType(null);
                      setProfileNameInput('');
                      setProfilePronounsInput('');
                      setPartnerNameInput('');
                      setPartnerPronounsInput('');
                    }}
                    className="flex-1 px-6 py-4 border-2 border-stone-200 text-stone-600 rounded-2xl font-bold hover:border-stone-300 transition-all"
                  >
                    {t('common.back')}
                  </button>
                  <button 
                    onClick={() => setSetupStep(2)}
                    disabled={!profileNameInput || !partnerNameInput}
                    className="flex-1 bg-stone-900 text-white py-4 rounded-2xl font-bold hover:bg-stone-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {t('common.next')}
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : setupStep === 2 && accountType === 'partner' ? (
            <motion.div 
              key="partnerConnection"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-md mx-auto w-full space-y-8 py-12"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
                  <Link2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h1 className="font-serif font-bold text-3xl text-stone-900">Connect to Partner's Account</h1>
                <p className="text-stone-500">Enter the connection code your partner shared with you</p>
              </div>

              <div className="space-y-6 bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                <div className="p-5 bg-red-50 border-l-4 border-red-400 rounded-lg">
                  <p className="text-sm text-red-900 leading-relaxed">
                    <strong>⚠️ Warning:</strong> Connecting to a partner's account will <strong>permanently delete all your personal data</strong> on this device, including personal coaching sessions. Couple sessions will be preserved. This action cannot be undone.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-stone-400 uppercase tracking-widest">Connection Code</label>
                    <input 
                      type="text"
                      value={partnerConnectionCode}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                        setPartnerConnectionCode(val);
                        setConnectionCodeError(null);
                      }}
                      placeholder="e.g. ABC123"
                      maxLength={6}
                      className="w-full p-4 bg-stone-50 border border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none font-mono text-lg text-center tracking-widest"
                    />
                    <p className="text-[10px] text-stone-400">6-character code from your partner</p>
                  </div>

                  {connectionCodeError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-2xl">
                      <p className="text-sm text-red-900">{connectionCodeError}</p>
                    </div>
                  )}


                </div>

                <div className="h-px bg-stone-100" />

                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setAccountType(null);
                      setSetupStep(0);
                      setPartnerConnectionCode('');
                      setConnectionCodeError(null);
                      setConfirmedDataWipeout(false);
                    }}
                    className="flex-1 px-6 py-4 border-2 border-stone-200 text-stone-600 rounded-2xl font-bold hover:border-stone-300 transition-all"
                  >
                    {t('common.back')}
                  </button>
                  <button 
                    onClick={async () => {
                      if (!partnerConnectionCode || partnerConnectionCode.length !== 6) {
                        setConnectionCodeError('Please enter a valid 6-character code');
                        return;
                      }
                      
                      setIsConnectingAsPartner(true);
                      try {
                        // Validate code exists in partner_requests
                        const q = query(
                          collection(db, 'partner_requests'),
                          where('code', '==', partnerConnectionCode),
                          where('status', '==', 'pending')
                        );
                        const snap = await getDocs(q);
                        if (snap.empty) {
                          setConnectionCodeError('Invalid or expired code. Ask your partner for a new one.');
                          setIsConnectingAsPartner(false);
                          return;
                        }
                        if (snap.docs[0].data().fromUid === user?.uid) {
                          setConnectionCodeError('You cannot connect with your own code.');
                          setIsConnectingAsPartner(false);
                          return;
                        }
                        // Claim the code
                        await updateDoc(doc(db, 'partner_requests', snap.docs[0].id), {
                          respondentUid: user?.uid,
                          respondentEmail: user?.email || '',
                          status: 'claimed'
                        });

                        // Success - partner waits for approval/sync; no coach selection step needed here.
                        setPartnerConnectionCode('');
                        showToast('Code geclaimd. Wachten op goedkeuring van hoofdaccount...', 'success');
                      } catch (err) {
                        console.error('Partner connection error:', err);
                        setConnectionCodeError(err instanceof Error ? err.message : 'Connection failed');
                      } finally {
                        setIsConnectingAsPartner(false);
                      }
                    }}
                    disabled={isConnectingAsPartner || !partnerConnectionCode || partnerConnectionCode.length !== 6}
                    className="flex-1 px-6 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                  >
                    {isConnectingAsPartner ? (
                      <>
                        <Loader className="w-5 h-5 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Link2 className="w-5 h-5" />
                        Connect
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="coachSelection"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-4xl mx-auto w-full space-y-8 py-12"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-emerald-600" />
                </div>
                <h1 className="font-serif font-bold text-3xl text-stone-900">{t('profile.coachSelectionTitle')}</h1>
                <p className="text-stone-500 max-w-lg mx-auto">{t('profile.coachSelectionSubtitle')}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {getCoachesList().map(coach => (
                  <button
                    key={coach.id}
                    onClick={() => {
                      setDefaultCoachInput(coach.id as AI.CoachPersona);
                      setPersonalCoachInput(coach.id as AI.CoachPersona);
                    }}
                    className={cn(
                      "text-left p-6 rounded-3xl border-2 transition-all space-y-4 relative overflow-hidden group",
                      defaultCoachInput === coach.id 
                        ? "bg-white border-emerald-500 shadow-xl shadow-emerald-500/10 ring-4 ring-emerald-500/5" 
                        : "bg-white border-stone-100 hover:border-stone-200 shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden border border-stone-100",
                        `bg-${coach.color}/10`
                      )}>
                        <img src={coach.avatarSmall} alt={coach.id} className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{t(`sessions.personas.${coach.id}.name`)}</h3>
                        <p className="text-xs text-stone-400 font-medium uppercase tracking-wider">{t(`sessions.personas.${coach.id}.title`)}</p>
                      </div>
                    </div>

                    <p className="text-sm text-stone-600 leading-relaxed italic">
                      "{coach.bio}"
                    </p>

                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {coach.traits.map(trait => (
                          <span key={trait} className="px-2 py-0.5 bg-stone-50 text-stone-500 rounded-md text-[10px] font-bold uppercase">
                            {trait}
                          </span>
                        ))}
                      </div>
                      <div className="pt-3 border-t border-stone-50">
                        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">{t('profile.method')}</p>
                        <p className="text-xs text-stone-500">{coach.methods.join(', ')}</p>
                      </div>
                    </div>

                    <div className={cn(
                      "absolute top-4 right-4 transition-all",
                      defaultCoachInput === coach.id ? "opacity-100 scale-100" : "opacity-0 scale-50"
                    )}>
                      <div className="w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-8">
                <button 
                  onClick={() => {
                    if (accountType === 'partner') {
                      setSetupStep(2);
                    } else {
                      setSetupStep(1);
                    }
                  }}
                  className="flex items-center gap-2 text-stone-400 font-bold text-sm hover:text-stone-600 transition-all"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                  {t('common.back')}
                </button>
                <button 
                  onClick={handleSaveProfile}
                  disabled={isProfileSaving}
                  className="px-12 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <Save className="w-5 h-5" />
                  {isProfileSaving ? t('common.loading') : t('profile.saveProfile')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="h-screen bg-stone-50 flex flex-col overflow-hidden pt-safe pb-safe">
      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'sessions' && !activeSession && (
            <motion.div 
              key="sessions"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col"
            >
              <header className="p-6 flex items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <img src={LOGO_IMAGES.main_v1} alt="Restart Our Love" className="w-10 h-10" />
                  <h1 className="font-lobster text-3xl">Restart our Love</h1>
                </div>
                <button 
                  onClick={() => setShowNewSessionModal(true)}
                  className="p-2 bg-emerald-100 text-emerald-700 rounded-full"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto px-6 space-y-4 pb-20">
                {/* Welcome & Stats Block */}
                <div className="mb-6 p-6 bg-white rounded-3xl border border-stone-200 shadow-sm space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-serif text-2xl font-bold text-stone-900">
                        {isSharedDeviceMode
                          ? t('dashboard.welcomePartner', {
                              name: decryptedProfile.name || profile.displayName,
                              partner: decryptedProfile.partnerName || 'Partner'
                            })
                          : t('dashboard.welcome', {
                              name: isPartnerAccount
                                ? (decryptedProfile.partnerName || profile.displayName)
                                : (decryptedProfile.name || profile.displayName)
                            })}
                      </h2>
                      <p className="text-xs text-stone-500 mt-1">
                        {new Date().toLocaleDateString(language === 'nl' ? 'nl-NL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                    </div>
                    <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-emerald-600" />
                    </div>
                  </div>

                  {profile?.subscriptionTier === 'free' ? (
                    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-xs font-bold text-stone-900 mb-1">
                          {t('dashboard.freeLimitInfo', { 
                            count: sessions.length.toString(),
                            name: decryptedProfile.name || profile.displayName,
                            partner: decryptedProfile.partnerName || 'Partner'
                          })}
                        </p>
                        <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 transition-all duration-500" 
                            style={{ width: `${Math.min(100, (sessions.length / 3) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <button 
                        onClick={handleUpgrade}
                        className="px-4 py-2 bg-stone-900 text-white text-[10px] font-bold rounded-xl hover:bg-stone-800 transition-all active:scale-[0.98] whitespace-nowrap"
                      >
                        {t('dashboard.buyNow')}
                      </button>
                    </div>
                  ) : stats && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">{t('dashboard.stats.totalSessions')}</p>
                        <p className="text-lg font-bold text-stone-900">{stats.totalSessions}</p>
                      </div>
                      <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">{t('dashboard.stats.totalMessages')}</p>
                        <p className="text-lg font-bold text-stone-900">{stats.totalMessages}</p>
                      </div>
                      <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">{t('dashboard.stats.milestones')}</p>
                        <p className="text-lg font-bold text-stone-900">{stats.milestones}</p>
                      </div>
                      <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
                        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">{t('dashboard.stats.daysJourney')}</p>
                        <p className="text-lg font-bold text-stone-900">{stats.daysJourney}</p>
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{t('sessions.title')}</p>
                {sessions.length === 0 ? (
                  <div className="py-12 text-center space-y-4">
                    <div className="w-16 h-16 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto">
                      <MessageCircle className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="text-stone-400 text-sm">{t('sessions.noSessions')}</p>
                  </div>
                ) : (
                  <>
                    {sessions.slice(0, 5).map(s => {
                      const coach = getCoach(s.coachPersona);
                      const isClosed = s.status === 'closed' || s.status === 'beeindigd';
                      return (
                        <div key={s.id} className="relative group">
                          <button 
                            onClick={() => setActiveSession(s)}
                            className={cn(
                              "w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left shadow-sm active:scale-[0.98]",
                              isClosed ? "bg-stone-50 border-stone-100 opacity-80" : "bg-white border-stone-200"
                            )}
                          >
                            <div className={cn(
                              "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                              isClosed ? "bg-stone-200 text-stone-500" : `bg-${coach.color}/10 text-${coach.color}`
                            )}>
                              {s.type === 'couple' ? <Users className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <p className={cn("font-bold", isClosed ? "text-stone-600" : `text-${coach.color}`)}>
                                  {t('chat.coachTitle', { persona: t(`sessions.personas.${coach.id}.name`) })}
                                </p>
                                <span className={cn(
                                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                                  isClosed ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-700"
                                )}>
                                  {t(`sessions.status.${s.status || 'active'}`)}
                                </span>
                              </div>
                              <p className="text-[10px] text-stone-500 flex flex-wrap gap-x-3">
                                <span>{s.type === 'couple' ? t('sessions.coupleSession') : t('sessions.personalSession')}</span>
                                {s.createdAt && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(s.createdAt.seconds * 1000).toLocaleDateString()}
                                  </span>
                                )}
                              </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-stone-300" />
                          </button>
                          
                          {!isClosed && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSessionToDelete(s.id);
                              }}
                              className="absolute -top-2 -right-2 w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center transition-all shadow-md border border-red-200 z-10 active:scale-90"
                              title={t('common.delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    
                    {sessions.length > 5 && (
                      <button 
                        onClick={() => setView('timeline')}
                        className="w-full py-4 text-center text-xs font-bold text-stone-400 hover:text-emerald-600 transition-all border-t border-stone-100 mt-2"
                      >
                        {t('sessions.viewAll')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )}

          {view === 'timeline' && (
            <motion.div 
              key="timeline"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col p-6 space-y-6 overflow-y-auto"
            >
              <header>
                <h1 className="font-serif font-bold text-3xl text-stone-900">{t('journey.title')}</h1>
                <p className="text-stone-500">{t('journey.subtitle')}</p>
              </header>

              {/* Homework Section */}
              <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm space-y-4">
                <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  {t('journey.homeworkTitle')}
                </h2>
                {homework.filter(h => h.status === 'assigned').length === 0 ? (
                  <p className="text-sm text-stone-400 italic">{t('journey.noHomework')}</p>
                ) : (
                  <div className="space-y-3">
                    {homework.filter(h => h.status === 'assigned').map(h => (
                      <div key={h.id} className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-emerald-900 text-sm">{h.decryptedTitle || 'Encrypted Task'}</h3>
                          <button 
                            onClick={async () => {
                              await updateDoc(doc(db, 'homework', h.id), { status: 'completed' });
                            }}
                            className="px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-lg"
                          >
                            {t('common.done')}
                          </button>
                        </div>
                        <p className="text-xs text-emerald-700 leading-relaxed">{h.decryptedDescription || 'Decrypting...'}</p>
                        {h.dueDate && (
                          <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold uppercase">
                            <Calendar className="w-3 h-3" />
                            {t('common.due')}: {new Date(h.dueDate.seconds * 1000).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Timeline Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setTimelineTab('couple')}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-bold transition-all border",
                    timelineTab === 'couple'
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
                  )}
                >
                  👥 {t('sessions.coupleSession')}
                </button>
                <button
                  onClick={() => setTimelineTab('personal')}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-bold transition-all border",
                    timelineTab === 'personal'
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
                  )}
                >
                  💬 {t('sessions.personalSession')}
                </button>
              </div>

              {/* Couple Sessions Timeline */}
              {timelineTab === 'couple' && (
                <div className="space-y-4">
                  {sessions.filter(s => s.type === 'couple').length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-stone-200">
                      <Users className="w-8 h-8 text-stone-200 mx-auto mb-2" />
                      <p className="text-sm text-stone-400">{t('journey.noSessions')}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sessions.filter(s => s.type === 'couple').sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(session => {
                        const coachInfo = getCoach(session.coachPersona);
                        const sessionDate = new Date(session.createdAt?.seconds * 1000);
                        const ownerName = decryptedProfile?.name || t('chat.you');
                        const partnerName = decryptedProfile?.partnerName || t('chat.partner');
                        const sessionTimeline = timeline.filter(t => t.sessionId === session.id);
                        
                        return (
                          <div key={session.id} className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm space-y-4">
                            {/* Session Info */}
                            <div className="space-y-3 pb-4 border-b border-stone-100">
                              <div className="flex items-center justify-between">
                                <h3 className="font-bold text-stone-900 text-lg flex items-center gap-2">
                                  <Users className="w-5 h-5 text-blue-500" />
                                  {ownerName} & {partnerName}
                                </h3>
                                <span className={cn(
                                  "text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                                  session.status === 'active' ? "bg-blue-100 text-blue-700" :
                                  session.status === 'archived' ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-700"
                                )}>
                                  {t(`sessions.status.${session.status}`)}
                                </span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 text-xs">
                                <div className="flex items-center gap-1 text-stone-600">
                                  <span className="font-bold text-stone-700">Coach:</span>
                                  <span>{t(`sessions.personas.${coachInfo.id}.name`)}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <Calendar className="w-3 h-3" />
                                  <span>{sessionDate.toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <Clock className="w-3 h-3" />
                                  <span>{sessionDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <MessageCircle className="w-3 h-3" />
                                  <span>{session.messageCount} {t('sessions.messages')}</span>
                                </div>
                              </div>
                            </div>

                            {/* Session Timeline Entries */}
                            {sessionTimeline.length === 0 ? (
                              <p className="text-xs text-stone-400 italic py-2">{t('journey.noTimeline')}</p>
                            ) : (
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest">Mijlpalen & Inzichten</h4>
                                <div className="relative pl-4 space-y-3 before:absolute before:left-0.5 before:top-0 before:bottom-0 before:w-0.5 before:bg-stone-100">
                                  {sessionTimeline.map((entry) => (
                                    <div key={entry.id} className="relative">
                                      <div className={cn(
                                        "absolute -left-2 top-1 w-3 h-3 rounded-full border-2 border-white shadow-sm",
                                        entry.type === 'milestone' ? "bg-emerald-500" : 
                                        entry.type === 'insight' ? "bg-amber-500" : "bg-indigo-500"
                                      )} />
                                      <div className="pl-2">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className={cn(
                                            "text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                                            entry.type === 'milestone' ? "bg-emerald-100 text-emerald-700" : 
                                            entry.type === 'insight' ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                                          )}>
                                            {t(`timeline.${entry.type}`)}
                                          </span>
                                        </div>
                                        <h5 className="font-bold text-stone-900 text-xs">{entry.decryptedTitle || t('timeline.encryptedEntry')}</h5>
                                        <p className="text-xs text-stone-500 leading-relaxed">{entry.decryptedDescription || t('timeline.decrypting')}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Personal Sessions Timeline */}
              {timelineTab === 'personal' && (
                <div className="space-y-4">
                  {sessions.filter(s => s.type === 'personal').length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-stone-200">
                      <MessageCircle className="w-8 h-8 text-stone-200 mx-auto mb-2" />
                      <p className="text-sm text-stone-400">{t('journey.noSessions')}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sessions.filter(s => s.type === 'personal').sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).map(session => {
                        const coachInfo = getCoach(session.coachPersona);
                        const sessionDate = new Date(session.createdAt?.seconds * 1000);
                        const isOwner = session.ownerUid === user?.uid;
                        const personName = isOwner ? (decryptedProfile?.name || t('chat.you')) : (decryptedProfile?.partnerName || t('chat.partner'));
                        const sessionTimeline = timeline.filter(t => t.sessionId === session.id);
                        
                        return (
                          <div key={session.id} className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm space-y-4">
                            {/* Session Info */}
                            <div className="space-y-3 pb-4 border-b border-stone-100">
                              <div className="flex items-center justify-between">
                                <h3 className="font-bold text-stone-900 text-lg flex items-center gap-2">
                                  <MessageCircle className="w-5 h-5 text-purple-500" />
                                  {personName}
                                </h3>
                                <span className={cn(
                                  "text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                                  session.status === 'active' ? "bg-purple-100 text-purple-700" :
                                  session.status === 'archived' ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-700"
                                )}>
                                  {t(`sessions.status.${session.status}`)}
                                </span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 text-xs">
                                <div className="flex items-center gap-1 text-stone-600">
                                  <span className="font-bold text-stone-700">Coach:</span>
                                  <span>{t(`sessions.personas.${coachInfo.id}.name`)}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <Calendar className="w-3 h-3" />
                                  <span>{sessionDate.toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <Clock className="w-3 h-3" />
                                  <span>{sessionDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="flex items-center gap-1 text-stone-600">
                                  <MessageCircle className="w-3 h-3" />
                                  <span>{session.messageCount} {t('sessions.messages')}</span>
                                </div>
                              </div>
                            </div>

                            {/* Session Timeline Entries */}
                            {sessionTimeline.length === 0 ? (
                              <p className="text-xs text-stone-400 italic py-2">{t('journey.noTimeline')}</p>
                            ) : (
                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest">Mijlpalen & Inzichten</h4>
                                <div className="relative pl-4 space-y-3 before:absolute before:left-0.5 before:top-0 before:bottom-0 before:w-0.5 before:bg-stone-100">
                                  {sessionTimeline.map((entry) => (
                                    <div key={entry.id} className="relative">
                                      <div className={cn(
                                        "absolute -left-2 top-1 w-3 h-3 rounded-full border-2 border-white shadow-sm",
                                        entry.type === 'milestone' ? "bg-emerald-500" : 
                                        entry.type === 'insight' ? "bg-amber-500" : "bg-indigo-500"
                                      )} />
                                      <div className="pl-2">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className={cn(
                                            "text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                                            entry.type === 'milestone' ? "bg-emerald-100 text-emerald-700" : 
                                            entry.type === 'insight' ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                                          )}>
                                            {t(`timeline.${entry.type}`)}
                                          </span>
                                        </div>
                                        <h5 className="font-bold text-stone-900 text-xs">{entry.decryptedTitle || t('timeline.encryptedEntry')}</h5>
                                        <p className="text-xs text-stone-500 leading-relaxed">{entry.decryptedDescription || t('timeline.decrypting')}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {view === 'admin' && (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col p-6 space-y-8 overflow-y-auto"
            >
              <header className="flex items-center justify-between">
                <div>
                  <h1 className="font-serif font-bold text-3xl text-stone-900">{t('admin.title')}</h1>
                  <p className="text-stone-500">{t('admin.subtitle')}</p>
                </div>
                <button onClick={() => setView('settings')} className="p-2 text-stone-400">
                  <ChevronRight className="w-6 h-6 rotate-180" />
                </button>
              </header>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4" />
                    {t('admin.openTickets')} ({tickets.filter(t => t.status === 'open').length})
                  </h2>
                  <button 
                    onClick={seedCrisisResources}
                    className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest hover:underline"
                  >
                    {t('admin.seedResources')}
                  </button>
                </div>
                
                {tickets.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-stone-200">
                    <p className="text-sm text-stone-400">{t('admin.noTickets')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {tickets.map(ticket => (
                      <div key={ticket.id} className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <span className={cn(
                            "text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                            ticket.status === 'open' ? "bg-red-100 text-red-700" : 
                            ticket.status === 'in_progress' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                          )}>
                            {t(`admin.status.${ticket.status}`)}
                          </span>
                          <span className="text-[10px] text-stone-400 font-medium">
                            {new Date(ticket.createdAt?.seconds * 1000).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <h3 className="font-bold text-stone-900">{ticket.subject}</h3>
                          <p className="text-sm text-stone-600 mt-1">{ticket.description}</p>
                        </div>
                        {ticket.plaintextSnippet && (
                          <div className="p-3 bg-stone-50 rounded-xl border border-stone-100">
                            <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">Plaintext Snippet (Debug):</p>
                            <pre className="text-[10px] text-stone-600 whitespace-pre-wrap font-mono">
                              {ticket.plaintextSnippet}
                            </pre>
                          </div>
                        )}
                        {ticket.fileUrl && (
                          <a 
                            href={ticket.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-xs text-emerald-700 font-bold"
                          >
                            <Paperclip className="w-4 h-4" />
                            {t('admin.viewAttachment')}
                          </a>
                        )}
                        <div className="flex gap-2">
                          <button 
                            onClick={async () => {
                              await updateDoc(doc(db, 'tickets', ticket.id), { status: 'in_progress' });
                            }}
                            className="flex-1 py-2 bg-stone-100 text-stone-600 text-xs font-bold rounded-xl hover:bg-stone-200 transition-colors"
                          >
                            {t('admin.markInProgress')}
                          </button>
                          <button 
                            onClick={async () => {
                              await updateDoc(doc(db, 'tickets', ticket.id), { status: 'resolved' });
                            }}
                            className="flex-1 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-colors"
                          >
                            {t('admin.resolve')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'safety' && (
            <motion.div 
              key="safety"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col p-6 space-y-8 overflow-y-auto"
            >
              <header>
                <h1 className="font-serif font-bold text-3xl text-stone-900">{t('safety.title')}</h1>
                <p className="text-stone-500">{t('safety.subtitle')}</p>
              </header>

              <div className="bg-red-50 p-6 rounded-3xl border border-red-100 space-y-4">
                <div className="flex items-center gap-3 text-red-700">
                  <AlertTriangle className="w-6 h-6" />
                  <h2 className="font-bold text-lg">{t('safety.emergencyTitle')}</h2>
                </div>
                <p className="text-sm text-red-600 leading-relaxed">
                  {t('safety.emergencySubtitle')}
                </p>
              </div>

              <div className="space-y-4">
                <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                  <LifeBuoy className="w-4 h-4" />
                  {t('safety.hotlinesTitle')}
                </h2>
                <div className="space-y-3">
                  {crisisResources.length === 0 ? (
                    <div className="p-4 bg-white rounded-2xl border border-stone-200 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center">
                            <Phone className="w-5 h-5 text-stone-400" />
                          </div>
                          <div>
                            <p className="font-bold text-stone-900 text-sm">988 Suicide & Crisis Lifeline</p>
                            <p className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Available 24/7 (US)</p>
                          </div>
                        </div>
                        <a href="tel:988" className="p-3 bg-stone-900 text-white rounded-xl">
                          <Phone className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  ) : (
                    crisisResources.map(res => (
                      <div key={res.id} className="p-4 bg-white rounded-2xl border border-stone-200 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center">
                              <Phone className="w-5 h-5 text-stone-400" />
                            </div>
                            <div>
                              <p className="font-bold text-stone-900 text-sm">{res.name}</p>
                              <p className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">{res.category.replace('_', ' ')}</p>
                            </div>
                          </div>
                          {res.phone && (
                            <a href={`tel:${res.phone}`} className="p-3 bg-stone-900 text-white rounded-xl">
                              <Phone className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-stone-500 leading-relaxed">{res.description}</p>
                        {res.website && (
                          <a 
                            href={res.website} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-block text-[10px] font-bold text-emerald-600 uppercase tracking-widest hover:underline"
                          >
                            {t('safety.visitWebsite')}
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4">
                <h2 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  {t('safety.planningTitle')}
                </h2>
                <p className="text-xs text-stone-500 leading-relaxed">
                  {t('safety.planningSubtitle')}
                </p>
                <button className="w-full py-3 bg-stone-50 text-stone-600 rounded-xl text-xs font-bold border border-stone-200">
                  {t('safety.createPlan')}
                </button>
              </div>
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="h-full flex flex-col p-6 space-y-8 overflow-y-auto"
            >
              <header>
                <h1 className="font-serif font-bold text-3xl text-stone-900">{t('settings.title')}</h1>
                <p className="text-stone-500">{t('settings.subtitle')}</p>
              </header>

              <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-sm space-y-6">
                <div className="flex items-center gap-4">
                  <img src={user.photoURL || ''} className="w-16 h-16 rounded-2xl border-2 border-stone-100" />
                  <div>
                    <p className="font-bold text-lg">{user.displayName}</p>
                    <p className="text-sm text-stone-500">{user.email}</p>
                  </div>
                </div>

                {isPartnerAccount && (
                  <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Partner Account</p>
                    <p className="text-xs text-stone-600">
                      Dit account is gekoppeld aan het hoofdaccount. Koppelinstellingen (profiel + koppelcoach) zijn alleen bewerkbaar vanuit het hoofdaccount en worden hier alleen getoond.
                    </p>
                  </div>
                )}

                {!isPartnerAccount && !!profile?.partnerUid && (
                  <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Shared Device Fallback</p>
                        <p className="text-xs text-stone-600">Standaard gebruikt ieder partner een eigen device. Zet dit aan om op dit hoofdaccount ook samen op 1 device te kunnen chatten.</p>
                      </div>
                      <button
                        onClick={handleToggleSharedDeviceFallback}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          sharedDeviceFallbackEnabled ? "bg-emerald-600" : "bg-stone-300"
                        )}
                        aria-label="Toggle shared device fallback"
                      >
                        <span
                          className={cn(
                            "inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
                            sharedDeviceFallbackEnabled ? "translate-x-5" : "translate-x-1"
                          )}
                        />
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-stone-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-600">{t('settings.subscription')}</span>
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold uppercase">{profile?.subscriptionTier}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-600">{t('settings.language')}</span>
                    <select 
                      value={language}
                      onChange={async (e) => {
                        const newLang = e.target.value as Language;
                        setLanguage(newLang);
                        if (user) {
                          await updateDoc(doc(db, 'users', user.uid), { language: newLang });
                        }
                      }}
                      className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1 text-sm font-medium focus:outline-none focus:border-emerald-500"
                    >
                      <option value="nl">Nederlands</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div className="h-px bg-stone-100" />
                  
                  <div className="space-y-4">
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('profile.editProfile')}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.yourName')}</label>
                        <input 
                          type="text"
                          value={profileNameInput}
                          onChange={(e) => setProfileNameInput(e.target.value)}
                          disabled={isPartnerAccount}
                          className={cn(
                            "w-full p-3 border rounded-xl text-sm",
                            isPartnerAccount
                              ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                              : "bg-stone-50 border-stone-100 focus:border-emerald-500 focus:outline-none"
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-col">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.yourPronouns')}</label>
                          <span className="text-[8px] text-stone-400 italic leading-tight">{t('profile.yourPronounsDesc')}</span>
                        </div>
                        <select 
                          value={profilePronounsInput}
                          onChange={(e) => setProfilePronounsInput(e.target.value)}
                          disabled={isPartnerAccount}
                          className={cn(
                            "w-full p-3 border rounded-xl text-sm appearance-none",
                            isPartnerAccount
                              ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                              : "bg-stone-50 border-stone-100 focus:border-emerald-500 focus:outline-none"
                          )}
                        >
                          <option value="">{t('common.select')}</option>
                          <option value="he">{t('profile.pronounsOptions.he')}</option>
                          <option value="she">{t('profile.pronounsOptions.she')}</option>
                          <option value="they">{t('profile.pronounsOptions.they')}</option>
                          <option value="other">{t('profile.pronounsOptions.other')}</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.partnerName')}</label>
                        <input 
                          type="text"
                          value={partnerNameInput}
                          onChange={(e) => setPartnerNameInput(e.target.value)}
                          disabled={isPartnerAccount}
                          className={cn(
                            "w-full p-3 border rounded-xl text-sm",
                            isPartnerAccount
                              ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                              : "bg-stone-50 border-stone-100 focus:border-emerald-500 focus:outline-none"
                          )}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-col">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.partnerPronouns')}</label>
                          <span className="text-[8px] text-stone-400 italic leading-tight">{t('profile.partnerPronounsDesc')}</span>
                        </div>
                        <select 
                          value={partnerPronounsInput}
                          onChange={(e) => setPartnerPronounsInput(e.target.value)}
                          disabled={isPartnerAccount}
                          className={cn(
                            "w-full p-3 border rounded-xl text-sm appearance-none",
                            isPartnerAccount
                              ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                              : "bg-stone-50 border-stone-100 focus:border-emerald-500 focus:outline-none"
                          )}
                        >
                          <option value="">{t('common.select')}</option>
                          <option value="he">{t('profile.pronounsOptions.he')}</option>
                          <option value="she">{t('profile.pronounsOptions.she')}</option>
                          <option value="they">{t('profile.pronounsOptions.they')}</option>
                          <option value="other">{t('profile.pronounsOptions.other')}</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.defaultCoach')}</label>
                        <select 
                          value={defaultCoachInput}
                          onChange={(e) => setDefaultCoachInput(e.target.value as AI.CoachPersona)}
                          disabled={isPartnerAccount}
                          className={cn(
                            "w-full p-3 border rounded-xl text-sm",
                            isPartnerAccount
                              ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                              : "bg-stone-50 border-stone-100 focus:border-emerald-500 focus:outline-none"
                          )}
                        >
                          {getCoachesList().map(c => (
                            <option key={c.id} value={c.id}>{t(`sessions.personas.${c.id}.name`)} ({t(`sessions.personas.${c.id}.title`)})</option>
                          ))}
                        </select>
                        {isPartnerAccount && (
                          <p className="text-[10px] text-stone-400">Koppelcoach wordt beheerd door het hoofdaccount.</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">{t('profile.personalCoach')}</label>
                        <select 
                          value={personalCoachInput}
                          onChange={(e) => setPersonalCoachInput(e.target.value as AI.CoachPersona)}
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none"
                        >
                          {getCoachesList().map(c => (
                            <option key={c.id} value={c.id}>{t(`sessions.personas.${c.id}.name`)} ({t(`sessions.personas.${c.id}.title`)})</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button 
                      onClick={handleSaveProfile}
                      disabled={isProfileSaving}
                      className="w-full py-3 bg-stone-900 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                    >
                      <Save className="w-4 h-4" />
                      {isProfileSaving ? t('common.loading') : (isPartnerAccount ? 'Sla eigen coach op' : t('profile.saveProfile'))}
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('settings.partnerConnection')}</p>
                    {profile?.partnerUid ? (
                      <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 space-y-1">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-900">{t('settings.partnerLinked')}</span>
                        </div>
                        <p className="text-xs text-emerald-900 font-medium">
                          {isPartnerAccount
                            ? `Gekoppeld aan hoofdaccount: ${linkedAccountSummary?.linkedDisplayName || '-'} (${linkedAccountSummary?.linkedEmail || '-'})`
                            : `Gekoppeld aan partneraccount: ${linkedAccountSummary?.linkedDisplayName || '-'} (${linkedAccountSummary?.linkedEmail || '-'})`}
                        </p>
                      </div>
                    ) : profile?.subscriptionTier === 'free' ? (
                      <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                        <p className="text-sm font-semibold text-stone-900">{t('settings.partnerModePremiumTitle')}</p>
                        <p className="text-xs text-stone-600 leading-relaxed">{t('settings.partnerModePremiumDescription')}</p>
                        <ul className="text-xs text-stone-600 space-y-1 list-disc list-inside">
                          <li>{t('settings.partnerModeBenefit1')}</li>
                          <li>{t('settings.partnerModeBenefit2')}</li>
                          <li>{t('settings.partnerModeBenefit3')}</li>
                        </ul>
                        <button
                          onClick={handleUpgrade}
                          className="w-full py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-all"
                        >
                          {t('settings.unlockPartnerMode')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Claimed requests: main account sees partner email + accept/reject */}
                        {partnerRequests.filter(r => r.fromUid === user.uid && r.status === 'claimed').map(req => (
                          <div key={req.id} className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
                            <p className="text-xs text-emerald-900 font-medium">{t('settings.partnerWantsToLink') || 'Partner wil koppelen'}:</p>
                            <p className="text-sm font-mono text-emerald-700">{req.respondentEmail}</p>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleAcceptPartnerRequest(req)}
                                className="flex-1 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg"
                              >
                                {t('common.accept') || 'Accepteer'}
                              </button>
                              <button 
                                onClick={async () => {
                                  await updateDoc(doc(db, 'partner_requests', req.id), { status: 'rejected' });
                                  showToast(t('settings.requestRejected') || 'Verzoek afgewezen', 'info');
                                }}
                                className="flex-1 py-2 bg-stone-200 text-stone-600 text-xs font-bold rounded-lg"
                              >
                                {t('common.reject') || 'Weiger'}
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Waiting for acceptance: partner sees waiting state */}
                        {partnerRequests.filter(r => r.respondentUid === user.uid && r.status === 'claimed').map(req => (
                          <div key={req.id} className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                            <p className="text-xs text-amber-800 font-medium">{t('settings.waitingForApproval') || 'Wachten op goedkeuring van je partner...'}</p>
                          </div>
                        ))}

                        {/* Generate code section */}
                        {linkCode ? (
                          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2">
                            <p className="text-xs text-emerald-900 font-medium">{t('settings.shareCode') || 'Deel deze code met je partner'}:</p>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 p-3 bg-white text-center text-lg font-mono font-bold tracking-widest text-emerald-600 rounded-lg border border-emerald-100">
                                {linkCode}
                              </code>
                              <button 
                                onClick={() => { navigator.clipboard.writeText(linkCode); showToast(t('settings.codeCopied') || 'Code gekopieerd!', 'success'); }}
                                className="p-3 bg-white text-emerald-600 rounded-lg border border-emerald-100"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            </div>
                            <button 
                              onClick={() => setLinkCode(null)}
                              className="w-full pt-2 text-xs text-emerald-600 font-medium"
                            >
                              {t('settings.generateNewCode') || 'Nieuwe code genereren'}
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={handleGenerateLinkCode}
                            className="w-full py-3 border-2 border-dashed border-emerald-200 rounded-xl text-emerald-600 text-sm font-bold hover:border-emerald-400 hover:bg-emerald-50 transition-all"
                          >
                            + {t('settings.generateLinkCode') || 'Genereer koppelcode'}
                          </button>
                        )}

                        {/* Enter code section */}
                        <div className="space-y-2">
                          <p className="text-[10px] text-stone-500 font-medium">{t('settings.haveCode') || 'Heb je een code van je partner?'}</p>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              value={linkCodeInput}
                              onChange={(e) => setLinkCodeInput(e.target.value.toUpperCase())}
                              placeholder="ABCDEF"
                              maxLength={6}
                              className="flex-1 px-3 py-2 text-center font-mono text-sm tracking-widest border border-stone-200 rounded-lg focus:outline-none focus:border-emerald-500"
                            />
                            <button 
                              onClick={handleClaimLinkCode}
                              disabled={linkCodeInput.length < 6 || isClaimingCode}
                              className="px-4 py-2 bg-stone-900 text-white text-xs font-bold rounded-lg disabled:opacity-50"
                            >
                              {isClaimingCode ? '...' : (t('settings.linkButton') || 'Koppel')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ✅ FEATURE: Partner Device Management - Generate Connection Code */}
                  {!isPartnerAccount && profile?.subscriptionTier === 'premium' && (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">Partner Device Setup</p>
                      <div className="space-y-3">
                        {generatedConnectionCode ? (
                          <div className="space-y-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                            <div className="space-y-2">
                              <p className="text-xs text-emerald-900 font-medium">Share this code with your partner:</p>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 p-3 bg-white text-center text-lg font-mono font-bold tracking-widest text-emerald-600 rounded-lg border border-emerald-100">
                                  {generatedConnectionCode}
                                </code>
                                <button 
                                  onClick={handleCopyConnectionCode}
                                  className="p-3 bg-white text-emerald-600 rounded-lg border border-emerald-100 hover:bg-emerald-50 transition-all"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                              </div>
                              {connectionCodeExpiresAt && (
                                <p className="text-[10px] text-emerald-600">
                                  Expires: {connectionCodeExpiresAt.toLocaleString()}
                                </p>
                              )}
                            </div>
                            <button 
                              onClick={() => {
                                setGeneratedConnectionCode(null);
                                setConnectionCodeExpiresAt(null);
                              }}
                              className="w-full py-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-all"
                            >
                              Generate New Code
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={handleGenerateConnectionCode}
                            disabled={isGeneratingCode}
                            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-emerald-200 text-emerald-600 rounded-xl text-sm font-bold hover:border-emerald-400 hover:bg-emerald-50 transition-all disabled:opacity-50"
                          >
                            {isGeneratingCode ? (
                              <>
                                <Loader className="w-4 h-4 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Link2 className="w-4 h-4" />
                                Generate Partner Device Code
                              </>
                            )}
                          </button>
                        )}
                        <p className="text-[10px] text-stone-500">
                          Partner devices connect using a 6-character code and inherit your PIN for same-session encryption.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {isFreeTierAccount && (
                  <div className="p-6 bg-stone-900 text-white rounded-3xl shadow-xl border border-stone-800 space-y-4 mb-4 overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 blur-3xl" />
                    <div className="relative">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="font-bold text-lg">{t('settings.goPremium')}</h3>
                      </div>
                      <p className="text-xs text-stone-400 leading-relaxed mb-4">
                        {t('settings.premiumSubtitle')}
                      </p>
                      <button 
                        onClick={handleUpgrade}
                        className="w-full py-3 bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-[0.98]"
                      >
                        {t('settings.upgradeButton')}
                      </button>
                    </div>
                  </div>
                )}

                {isAdmin && (
                  <button 
                    onClick={() => setView('admin')}
                    className="w-full flex items-center justify-between p-4 bg-stone-900 text-white rounded-2xl shadow-lg mb-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center">
                        <Shield className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">Admin Dashboard</p>
                        <p className="text-[10px] text-stone-400 uppercase font-bold tracking-widest">Manage Support Tickets</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-stone-500" />
                  </button>
                )}

                <button 
                  onClick={() => setShowSupportModal(true)}
                  className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-stone-200 shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-stone-900 text-sm">Support & Feedback</p>
                      <p className="text-[10px] text-stone-500 uppercase font-bold tracking-widest">Help Center</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-stone-300" />
                </button>

                <button 
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-red-50 text-red-600 rounded-2xl font-bold"
                >
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </button>

                <button
                  onClick={() => setShowDeleteAccountModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-white border border-red-200 text-red-700 rounded-2xl font-bold"
                >
                  <AlertTriangle className="w-5 h-5" />
                  Account Verwijderen (GDPR)
                </button>
                <p className="text-center text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                  <Shield className="inline w-3 h-3 mr-1" />
                  Restart Our Love v1.0.0
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Account Modal */}
        <AnimatePresence>
          {showDeleteAccountModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-8 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-serif font-bold text-stone-900">Account Verwijderen</h2>
                  <button onClick={() => setShowDeleteAccountModal(false)} className="p-2 text-stone-400">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-900 space-y-2">
                  <p>Deze actie verwijdert je account en gekoppelde data permanent uit de database.</p>
                  <p>Als er een gekoppeld partneraccount bestaat, wordt dat partneraccount ook permanent verwijderd.</p>
                  <p className="text-xs">Actieve web-abonnementen (Stripe) worden geprobeerd te stoppen. App Store/Play Store abonnementen moet je zelf in de store annuleren.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Typ VERWIJDER om te bevestigen</label>
                  <input
                    type="text"
                    value={deleteAccountConfirmText}
                    onChange={(e) => setDeleteAccountConfirmText(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-4 focus:outline-none focus:border-red-500 transition-all"
                    placeholder="VERWIJDER"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteAccountModal(false)}
                    className="flex-1 py-3 bg-stone-100 text-stone-700 rounded-2xl font-bold"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount || deleteAccountConfirmText.trim().toUpperCase() !== 'VERWIJDER'}
                    className="flex-1 py-3 bg-red-600 text-white rounded-2xl font-bold disabled:opacity-50"
                  >
                    {isDeletingAccount ? 'Verwijderen...' : 'Permanent Verwijderen'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Support Modal */}
        <AnimatePresence>
          {showSupportModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            >
              <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-8 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-serif font-bold text-stone-900">Support</h2>
                  <button onClick={() => setShowSupportModal(false)} className="p-2 text-stone-400"><X className="w-6 h-6" /></button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Subject</label>
                    <input 
                      type="text"
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="What's happening?"
                      className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-4 focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Description</label>
                    <textarea 
                      value={supportDescription}
                      onChange={(e) => setSupportDescription(e.target.value)}
                      placeholder="Tell us more..."
                      className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-4 focus:outline-none focus:border-emerald-500 transition-all min-h-[120px]"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Attachment (Optional)</label>
                    <input 
                      type="file" 
                      onChange={(e) => setSupportFile(e.target.files?.[0] || null)}
                      className="w-full text-xs text-stone-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-stone-100 file:text-stone-700 hover:file:bg-stone-200"
                    />
                  </div>
                  
                  {activeSession && (
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl">
                      <input 
                        type="checkbox"
                        id="includeSnippet"
                        checked={includeSnippet}
                        onChange={(e) => setIncludeSnippet(e.target.checked)}
                        className="w-5 h-5 accent-emerald-600"
                      />
                      <label htmlFor="includeSnippet" className="text-xs text-emerald-900 font-medium">
                        Include last 5 messages as plaintext for debugging (Consent required)
                      </label>
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleCreateTicket}
                  disabled={!supportSubject || !supportDescription || isUploading}
                  className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold disabled:opacity-50"
                >
                  {isUploading ? t('common.loading') : t('common.save')}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Full Screen Chat Overlay */}
        <AnimatePresence>
          {activeSession && (
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-0 bg-white z-40 flex flex-col pt-safe pb-safe"
            >
              <header className="h-16 border-b border-stone-100 px-4 flex items-center justify-between bg-white/80 backdrop-blur-md">
                <button 
                  onClick={() => setActiveSession(null)}
                  className="p-2 text-stone-400"
                >
                  <ChevronRight className="w-6 h-6 rotate-180" />
                </button>
                <div className="flex flex-col items-center">
                  <h2 className={cn("font-bold", `text-${getCoach(activeSession.coachPersona).color}`)}>
                    {t('chat.coachTitle', { persona: t(`sessions.personas.${getCoach(activeSession.coachPersona).id}.name`) })}
                  </h2>
                  <span className="text-[10px] text-stone-400 uppercase font-bold tracking-tighter">
                    {activeSession.type === 'couple' ? t('sessions.coupleSession') : t('sessions.personalSession')}
                  </span>
                </div>
                {activeSession.status !== 'closed' && activeSession.status !== 'beeindigd' ? (
                  <button 
                    onClick={handleSummary}
                    className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {t('sessions.finish')}
                  </button>
                ) : (
                  <button 
                    onClick={async () => {
                      if (!activeSSK) {
                        showToast(t('common.loading'), 'info');
                        return;
                      }
                      
                      const currentSession = sessions.find(s => s.id === activeSession.id) || activeSession;
                      let decryptedSummary = null;

                      // 1. Try to load summary from session document
                      if (currentSession.summary) {
                        try {
                          const summaryData = typeof currentSession.summary === 'string' 
                            ? { ciphertext: currentSession.summary, iv: (currentSession as any).summaryIv }
                            : currentSession.summary;
                          
                          if (summaryData.ciphertext && summaryData.iv) {
                            decryptedSummary = await Encryption.decryptText(summaryData, activeSSK);
                          }
                        } catch (e) {
                          console.error("Failed to decrypt session summary", e);
                        }
                      }

                      // 2. Fallback: Try to find summary in timeline
                      if (!decryptedSummary) {
                        try {
                          const timelineRef = collection(db, 'timeline');
                          const q = query(
                            timelineRef, 
                            where('sessionId', '==', activeSession.id),
                            where('type', '==', 'milestone')
                          );
                          const snap = await getDocs(q);
                          const milestone = snap.docs.find(d => {
                            const data = d.data();
                            // Session summary milestones usually have a specific title or we can just try the first one
                            return data.description && data.descriptionIv;
                          });

                          if (milestone) {
                            const data = milestone.data();
                            decryptedSummary = await Encryption.decryptText({
                              ciphertext: data.description,
                              iv: data.descriptionIv
                            }, activeSSK);
                          }
                        } catch (e) {
                          console.error("Failed to fallback to timeline summary", e);
                        }
                      }

                      if (decryptedSummary) {
                        setSummary(decryptedSummary);
                      } else {
                        showToast(t('sessions.noSummary'), 'info');
                      }
                    }}
                    className="px-3 py-1.5 bg-stone-100 text-stone-600 rounded-lg text-[10px] font-bold uppercase flex items-center gap-1"
                  >
                    <Sparkles className="w-4 h-4" />
                    {t('sessions.viewSummary')}
                  </button>
                )}
              </header>

              {isCrisisDetected && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="bg-red-600 text-white p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-6 h-6 shrink-0" />
                    <div className="text-xs">
                      <p className="font-bold">{t('safety.alertTitle')}</p>
                      <p className="opacity-90">{t('safety.alertSubtitle')}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setActiveSession(null);
                      setView('safety');
                    }}
                    className="px-3 py-1.5 bg-white text-red-600 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap"
                  >
                    {t('safety.getHelpNow')}
                  </button>
                </motion.div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((m) => (
                  <div 
                    key={m.id} 
                    className={cn(
                      "flex flex-col max-w-[85%]",
                      m.senderUid === user.uid 
                        ? "ml-auto items-end" 
                        : m.senderUid === 'ai_coach'
                          ? "mx-auto items-center text-center"
                          : "mr-auto items-start"
                    )}
                  >
                    <div className={cn(
                      "p-3 rounded-2xl text-sm leading-relaxed",
                      m.senderUid === user.uid 
                        ? "bg-slate-700 text-white rounded-tr-none shadow-sm" 
                        : m.senderUid === 'ai_coach'
                          ? "bg-emerald-50 text-emerald-900 border border-emerald-100 shadow-sm"
                          : "bg-slate-700 text-white rounded-tl-none"
                    )}>
                      <div className="prose prose-sm prose-stone dark:prose-invert">
                        <ReactMarkdown>
                          {m.decryptedText || '...'}
                        </ReactMarkdown>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {m.senderUid === 'ai_coach' && (
                        <div className="w-5 h-5 rounded-lg overflow-hidden border border-emerald-200 flex-shrink-0">
                          <img 
                            src={getCoach(activeSession!.coachPersona).avatarSmall} 
                            alt={getCoach(activeSession!.coachPersona).id}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-wider",
                        m.senderUid === 'ai_coach' 
                          ? "text-emerald-600" 
                          : m.senderUid === user.uid 
                            ? "text-stone-400" 
                            : "text-stone-500"
                      )}>
                        {m.senderUid === 'ai_coach' 
                          ? t('chat.coachTitle', { persona: t(`sessions.personas.${getCoach(activeSession!.coachPersona).id}.name`) }) 
                          : m.senderProfileId === profile?.profileId
                            ? (decryptedProfile.name || t('chat.you')) 
                            : m.senderProfileId === profile?.partnerId
                              ? (decryptedProfile.partnerName || t('chat.partner'))
                              : m.senderUid === user.uid
                                ? (decryptedProfile.name || t('chat.you'))
                                : (decryptedProfile.partnerName || t('chat.partner'))}
                      </span>
                    </div>
                  </div>
                ))}
                {isAiLoading && (
                  <div className="flex items-center gap-1 p-2">
                    <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                    <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                    <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 bg-stone-300 rounded-full" />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <footer className="p-4 border-t border-stone-100 bg-white relative">
                <AnimatePresence>
                  {responseTip && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-4 right-4 mb-2 p-3 bg-emerald-600 text-white rounded-2xl text-xs shadow-lg flex items-start gap-2"
                    >
                      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-bold mb-1 uppercase tracking-widest text-[8px]">{t('sessions.tipTitle')}</p>
                        <p>{responseTip}</p>
                      </div>
                      <button onClick={() => setResponseTip(null)} className="p-1 hover:bg-white/20 rounded-full">
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {activeSession.status !== 'closed' && activeSession.status !== 'beeindigd' ? (
                  <>
                    {activeSession.type === 'couple' && isSharedDeviceMode && (
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          onClick={() => setSelectedSpeakerUid(activeSession.ownerProfileId || profile?.profileId || null)}
                          className={cn(
                            "px-3 py-1 rounded-full text-xs font-bold border transition-all",
                            (selectedSpeakerUid === (activeSession.ownerProfileId || profile?.profileId))
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-white text-stone-600 border-stone-200"
                          )}
                        >
                          {decryptedProfile.name || t('chat.you')}
                        </button>
                        <button
                          onClick={() => setSelectedSpeakerUid(activeSession.partnerProfileId || profile?.partnerId || null)}
                          className={cn(
                            "px-3 py-1 rounded-full text-xs font-bold border transition-all",
                            (selectedSpeakerUid === (activeSession.partnerProfileId || profile?.partnerId))
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-white text-stone-600 border-stone-200"
                          )}
                        >
                          {decryptedProfile.partnerName || t('chat.partner')}
                        </button>
                      </div>
                    )}

                    <div className="flex items-end gap-2">
                      <button 
                        onClick={handleGetTip}
                        disabled={isTipLoading || messages.length === 0}
                        className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl disabled:opacity-50"
                      >
                        {isTipLoading ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Info className="w-5 h-5" /></motion.div> : <Lightbulb className="w-5 h-5" />}
                      </button>
                      <textarea 
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (newMessage.trim() && !isAiLoading) {
                              handleSendMessage();
                            }
                          }
                        }}
                        placeholder={coupleMessagePlaceholder}
                        className="flex-1 bg-stone-50 border border-stone-200 rounded-2xl p-3 focus:outline-none focus:border-emerald-500 transition-all resize-none min-h-[44px] max-h-[120px] text-sm"
                      />
                      <button 
                        onClick={handleSendMessage}
                        disabled={!newMessage.trim() || isAiLoading}
                        className="p-3 bg-stone-900 text-white rounded-2xl disabled:opacity-50"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 text-center">
                    <p className="text-stone-500 text-sm font-medium flex items-center justify-center gap-2">
                      <Lock className="w-4 h-4" />
                      {t('sessions.closedSessionNotice')}
                    </p>
                  </div>
                )}
              </footer>

              {/* Summary Modal */}
              <AnimatePresence>
                {summary && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-end"
                  >
                    <motion.div 
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      exit={{ y: '100%' }}
                      className="bg-white w-full rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-serif font-bold">{t('sessions.summaryTitle')}</h3>
                        <button onClick={() => {
                          setSummary(null);
                          setSessionHomework([]);
                        }} className="p-2 text-stone-400">
                          <Plus className="w-6 h-6 rotate-45" />
                        </button>
                      </div>
                      <div className="prose prose-sm prose-stone">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>

                      {/* Homework Section */}
                      {sessionHomework && sessionHomework.length > 0 && (
                        <div className="mt-8 pt-8 border-t border-stone-200">
                          <h4 className="text-lg font-serif font-bold mb-4 text-emerald-700">
                            {language === 'nl' ? 'Huiswerkopdrachten' : 'Homework Assignments'}
                          </h4>
                          <div className="space-y-4">
                            {sessionHomework.map((task, idx) => (
                              <div key={idx} className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                                <h5 className="font-bold text-stone-800 mb-2">{task.title}</h5>
                                <p className="text-stone-700 text-sm mb-2">{task.description}</p>
                                {task.dueDate && (
                                  <p className="text-xs text-stone-500">
                                    {language === 'nl' ? 'Uiterste datum:' : 'Due date:'} {new Date(task.dueDate).toLocaleDateString(language === 'nl' ? 'nl-NL' : 'en-US')}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button 
                        onClick={() => {
                          setSummary(null);
                          setSessionHomework([]);
                          setActiveSession(null);
                          setView('sessions');
                        }}
                        className="w-full mt-8 py-4 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all active:scale-[0.98]"
                      >
                        {t('sessions.finishSession')}
                      </button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              {isSummaryLoading && (
                <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                      <Sparkles className="w-10 h-10 text-emerald-600" />
                    </motion.div>
                    <p className="font-serif italic text-stone-600">{t('sessions.summaryLoading')}</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-24 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full shadow-lg z-50 text-sm font-medium",
              toast.type === 'success' ? "bg-emerald-500 text-white" :
              toast.type === 'error' ? "bg-rose-500 text-white" :
              "bg-zinc-800 text-white"
            )}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation */}
      <nav className="h-20 bg-white border-t border-stone-100 flex items-center justify-around px-2">
        <button 
          onClick={() => { setView('sessions'); setActiveSession(null); }}
          className={cn(
            "flex flex-col items-center gap-2 py-2 px-1 transition-colors",
            view === 'sessions' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <MessageCircle className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{t('common.chats')}</span>
        </button>
        <button 
          onClick={() => { setView('timeline'); setActiveSession(null); }}
          className={cn(
            "flex flex-col items-center gap-2 py-2 px-1 transition-colors",
            view === 'timeline' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{t('common.journey')}</span>
        </button>
        <button 
          onClick={() => { setView('safety'); setActiveSession(null); }}
          className={cn(
            "flex flex-col items-center gap-2 py-2 px-1 transition-colors",
            view === 'safety' ? "text-red-600" : "text-stone-400"
          )}
        >
          <LifeBuoy className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{t('common.safety')}</span>
        </button>
        <button 
          onClick={() => { setView('settings'); setActiveSession(null); }}
          className={cn(
            "flex flex-col items-center gap-2 py-2 px-1 transition-colors",
            view === 'settings' ? "text-emerald-600" : "text-stone-400"
          )}
        >
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{t('common.settings')}</span>
        </button>
      </nav>

      {/* New Session Modal */}
      <AnimatePresence>
        {showNewSessionModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-end"
          >
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full rounded-t-3xl overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100">
                <h3 className="text-xl font-serif font-bold text-stone-900">{t('sessions.newSessionTitle')}</h3>
                <p className="text-stone-500 text-xs">{t('sessions.newSessionSubtitle')}</p>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{t('sessions.sessionType')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setNewSessionConfig(prev => ({ ...prev, type: 'couple', persona: profile?.defaultCoupleCoach || defaultCoachInput }))}
                      className={cn(
                        "p-4 rounded-2xl border-2 transition-all text-left",
                        newSessionConfig.type === 'couple' ? "border-emerald-500 bg-emerald-50" : "border-stone-100"
                      )}
                    >
                      <Users className="w-5 h-5 mb-1 text-stone-900" />
                      <p className="font-bold text-sm">{t('sessions.couple')}</p>
                    </button>
                    <button 
                      onClick={() => setNewSessionConfig(prev => ({ ...prev, type: 'personal', persona: profile?.personalCoach || personalCoachInput }))}
                      className={cn(
                        "p-4 rounded-2xl border-2 transition-all text-left",
                        newSessionConfig.type === 'personal' ? "border-emerald-500 bg-emerald-50" : "border-stone-100"
                      )}
                    >
                      <UserIcon className="w-5 h-5 mb-1 text-stone-900" />
                      <p className="font-bold text-sm">{t('sessions.personal')}</p>
                    </button>
                  </div>
                </div>


                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{t('sessions.coachPersona')}</label>
                  <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
                    {(() => {
                      const selectedCoachId = newSessionConfig.type === 'couple' 
                        ? (profile?.defaultCoupleCoach || defaultCoachInput) 
                        : (profile?.personalCoach || personalCoachInput);
                      const coach = getCoachesList().find(c => c.id === selectedCoachId);
                      const personaData = coach ? t(`sessions.personas.${coach.id}`) : { name: '...', title: '...', description: '...' };
                      
                      return (
                        <div className="flex gap-4 items-start">
                          {coach && (
                            <div className={cn(
                              "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-stone-100",
                              `bg-${coach.color}/20`
                            )}>
                              <img src={coach.avatarSmall} alt={coach.id} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <p className="font-bold text-sm text-stone-900">{personaData.name}</p>
                                <p className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter bg-white text-stone-600 inline-block mt-1">
                                  {personaData.title}
                                </p>
                              </div>
                            </div>
                            <p className="text-xs text-stone-600 leading-relaxed">
                              {personaData.description}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="pt-2 border-t border-emerald-100">
                      <p className="text-[10px] text-stone-500 italic">
                        💡 {t('sessions.coachCanBeChangedInSettings')}
                      </p>
                    </div>
                  </div>
                </div>

                {newSessionConfig.type === 'personal' && (
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{t('sessions.personal')} - {t('sessions.whoIsThisFor')}</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setNewSessionConfig(prev => ({ ...prev, personalSessionOwnerId: undefined }))}
                        className={cn(
                          "p-4 rounded-2xl border-2 transition-all text-center",
                          !newSessionConfig.personalSessionOwnerId
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-stone-100 hover:border-stone-300"
                        )}
                      >
                        <p className="font-bold text-sm text-stone-900">{decryptedProfile.name || t('chat.you')}</p>
                        <p className="text-[10px] text-stone-500 mt-1">{t('sessions.forMe')}</p>
                      </button>
                      <button
                        onClick={() => {
                          if (profile?.partnerId) {
                            setNewSessionConfig(prev => ({ ...prev, personalSessionOwnerId: 'partner' }));
                          }
                        }}
                        disabled={!profile?.partnerId || (hasLinkedPartnerDevice && !isSharedDeviceMode && !isPartnerAccount)}
                        className={cn(
                          "p-4 rounded-2xl border-2 transition-all text-center",
                          newSessionConfig.personalSessionOwnerId === 'partner'
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-stone-100 hover:border-stone-300",
                          (!profile?.partnerId || (hasLinkedPartnerDevice && !isSharedDeviceMode && !isPartnerAccount)) && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <p className="font-bold text-sm text-stone-900">{decryptedProfile.partnerName || t('chat.partner')}</p>
                        <p className="text-[10px] text-stone-500 mt-1">{t('sessions.forPartner')}</p>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setShowNewSessionModal(false)}
                    className="flex-1 py-4 text-stone-500 font-bold"
                  >
                    {t('common.cancel')}
                  </button>
                  <button 
                    onClick={handleCreateSession}
                    className="flex-[2] py-4 bg-stone-900 text-white rounded-2xl font-bold"
                  >
                    {t('common.start')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Session Confirmation Modal */}
      <AnimatePresence>
        {sessionToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-serif font-bold text-stone-900 text-center mb-2">
                {t('sessions.deleteConfirmTitle')}
              </h3>
              <p className="text-stone-500 text-center text-sm mb-6">
                {t('sessions.deleteConfirmMessage')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setSessionToDelete(null)}
                  className="flex-1 py-3 bg-stone-100 text-stone-900 rounded-2xl font-bold hover:bg-stone-200 transition-all active:scale-[0.98]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => handleDeleteSession(sessionToDelete)}
                  className="flex-1 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all active:scale-[0.98]"
                >
                  {t('common.delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
