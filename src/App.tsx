import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  auth, db, storage
} from './firebase';
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
  Clock
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
  subscriptionTier: 'free' | 'premium';
  partnerUid?: string;
  partnerId?: string; // Unique ID of the partner person
  role?: 'user' | 'admin';
  language?: Language;
  createdAt?: any;
  updatedAt?: any;
  profileName?: { ciphertext: string; iv: string };
  profilePronouns?: { ciphertext: string; iv: string };
  partnerName?: { ciphertext: string; iv: string };
  partnerPronouns?: { ciphertext: string; iv: string };
  defaultCoupleCoach?: AI.CoachPersona;
  personalCoach?: AI.CoachPersona;
}

interface ChatSession {
  id: string;
  type: 'personal' | 'couple';
  ownerUid: string; // User ID of account owner (for access control)
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
  toEmail: string;
  status: 'pending' | 'accepted' | 'rejected';
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
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  const [decryptedProfile, setDecryptedProfile] = useState<{
    name?: string;
    pronouns?: string;
    partnerName?: string;
    partnerPronouns?: string;
  }>({});

  const isAdmin = user?.email === 'wouter.de.heer@gmail.com' || profile?.role === 'admin';
  const [partnerRequests, setPartnerRequests] = useState<PartnerRequest[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [crisisResources, setCrisisResources] = useState<CrisisResource[]>([]);

  const stats = useMemo(() => {
    if (!profile || profile.subscriptionTier !== 'premium') return null;
    
    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((acc, s) => acc + (s.messageCount || 0), 0);
    const milestones = timeline.filter(t => t.type === 'milestone').length;
    
    // Calculate days since profile creation
    const startTimestamp = profile.createdAt?.seconds || Date.now() / 1000;
    const daysJourney = Math.max(1, Math.ceil((Date.now() / 1000 - startTimestamp) / (24 * 3600)));
    
    return { totalSessions, totalMessages, milestones, daysJourney };
  }, [profile, sessions, timeline]);
  const isProfileIncomplete = profile && !profile.profileName;
  const [newMessage, setNewMessage] = useState('');
  const [selectedSpeakerUid, setSelectedSpeakerUid] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (activeSession && user && profile && !selectedSpeakerUid) {
      setSelectedSpeakerUid(profile.profileId);  // Always use profileId for proper attribution
    }
  }, [activeSession?.id, user?.uid, profile?.profileId]);

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
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            if (data.language) setLanguage(data.language);
          } else {
            setProfile(null);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        });
      } else {
        if (unsubscribeProfile) unsubscribeProfile();
        setProfile(null);
        setIsPinVerified(false);
        setKek(null);
        setCk(null);
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

        // Pre-fill inputs if they are empty
        if (!profileNameInput) setProfileNameInput(name);
        if (!profilePronounsInput) setProfilePronounsInput(mappedPronouns);
        if (!partnerNameInput) setPartnerNameInput(partnerName);
        if (!partnerPronounsInput) setPartnerPronounsInput(mappedPartnerPronouns);
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
      } catch (e) {
        console.error("Failed to decrypt profile data", e);
      }
    };

    decryptProfile();
  }, [profile, ck]);

  // --- Partner Request Listener ---
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'partner_requests'),
      where('toEmail', '==', user.email),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PartnerRequest));
      setPartnerRequests(reqs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'partner_requests');
    });

    return unsubscribe;
  }, [user]);

  // --- RK Derivation for Sender ---
  useEffect(() => {
    if (!user || !profile || !exchangeKey || !kek || profile.wrappedRK || !profile.partnerUid) return;

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
  }, [user, profile, exchangeKey, kek]);

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

  // --- Admin Tickets Listener ---
  useEffect(() => {
    if (!isAdmin) return;

    const q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'tickets'));

    return unsub;
  }, [isAdmin]);

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
  };

  const handleSetupPin = async () => {
    if (!user || pin.length < 4) return;

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

    try {
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
    if (!user || !ck) {
      console.error("Cannot save profile: user or ck is missing", { user: !!user, ck: !!ck });
      return;
    }
    setIsProfileSaving(true);
    try {
      console.log("Encrypting profile data...");
      const encryptedName = await Encryption.encryptText(profileNameInput, ck);
      const encryptedPronouns = await Encryption.encryptText(profilePronounsInput, ck);
      const encryptedPartnerName = await Encryption.encryptText(partnerNameInput, ck);
      const encryptedPartnerPronouns = await Encryption.encryptText(partnerPronounsInput, ck);

      const path = `users/${user.uid}`;
      const updateData = {
        profileName: encryptedName,
        profilePronouns: encryptedPronouns,
        partnerName: encryptedPartnerName,
        partnerPronouns: encryptedPartnerPronouns,
        defaultCoupleCoach: defaultCoachInput,
        personalCoach: personalCoachInput,
        updatedAt: serverTimestamp()
      };

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

  const handleSendPartnerRequest = async (email: string) => {
    if (!user || !email) return;
    try {
      await addDoc(collection(db, 'partner_requests'), {
        fromUid: user.uid,
        fromEmail: user.email,
        toEmail: email,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      showToast(t('auth.alerts.requestSent'), 'success');
    } catch (e) {
      console.error("Failed to send request", e);
    }
  };

  const handleAcceptPartnerRequest = async (req: PartnerRequest) => {
    if (!user || !exchangeKey || !kek) return;
    try {
      // 1. Fetch sender's public key
      const senderSnap = await getDoc(doc(db, 'users', req.fromUid));
      if (!senderSnap.exists()) throw new Error("Sender profile not found");
      const senderProfile = senderSnap.data() as UserProfile;

      // 2. Derive Shared Secret (Relationship Key)
      const remotePubKey = await Encryption.importPublicKey(senderProfile.exchangePublicKey);
      const sharedSecret = await Encryption.deriveSharedSecret(exchangeKey, remotePubKey);
      const wrappedRk = await Encryption.wrapKey(sharedSecret, kek);

      // 3. Update request status
      await updateDoc(doc(db, 'partner_requests', req.id), { status: 'accepted' });

      // 4. Update both user profiles
      await updateDoc(doc(db, 'users', user.uid), { 
        partnerUid: req.fromUid,
        wrappedRK: wrappedRk
      });
      
      // Note: The sender will need to derive their RK when they see the acceptance
      // We'll add an effect for that.
      await updateDoc(doc(db, 'users', req.fromUid), { partnerUid: user.uid });

      setRk(sharedSecret);
      showToast(t('auth.alerts.partnerLinked'), 'success');
    } catch (e) {
      console.error("Failed to accept request", e);
    }
  };
  const handleCreateSession = async () => {
    if (!user || !ck || !profile?.profileId) return;

    // Check free tier limit (max 3 sessions)
    if (profile?.subscriptionTier === 'free' && sessions.length >= 3) {
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

    const sessionData: any = {
      type: newSessionConfig.type,
      ownerUid: user.uid, // User account owner (for access control)
      ownerProfileId,
      coachPersona: newSessionConfig.persona,
      coachGender: newSessionConfig.gender,
      status: 'active',
      createdAt: serverTimestamp(),
      messageCount: 0,
      wrappedSSK: wrappedSSK
    };

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

      // Delete all messages in the session subcollection
      const messagesQuery = query(collection(db, 'sessions', sessionId, 'messages'));
      const messagesSnapshot = await getDocs(messagesQuery);
      const batch = writeBatch(db);
      messagesSnapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      // Delete the session document
      await deleteDoc(doc(db, 'sessions', sessionId));

      showToast(t('sessions.alerts.sessionDeleted'), 'success');
      setSessionToDelete(null);
      
      // If the deleted session was active, close it and return to dashboard
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setView('sessions');
      }
    } catch (e) {
      console.error("Failed to delete session", e);
      handleFirestoreError(e, OperationType.DELETE, `sessions/${sessionId}`);
      setSessionToDelete(null);
    }
  };

  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
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
        
        const isPremium = profile?.subscriptionTier === 'premium';
        const result = await AI.generateSummary(history, language, isPremium);
        setSummary(result.summary);

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

        // Always save a Session Summary entry to the timeline for all users
        const summaryTitle = language === 'nl' ? 'Sessie Samenvatting' : 'Session Summary';
        const encryptedTimelineTitle = await Encryption.encryptText(summaryTitle, activeSSK);
        const encryptedTimelineDesc = await Encryption.encryptText(result.summary, activeSSK);
        
        await addDoc(collection(db, 'timeline'), {
          sessionId: activeSession.id,
          ownerUid: user!.uid,
          partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
                ownerUid: user!.uid,
                partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
        if (result.homework && result.homework.length > 0) {
          for (const task of result.homework) {
            if (!task.title || !task.description) continue;
            const encryptedTitle = await Encryption.encryptText(task.title, activeSSK);
            const encryptedDescription = await Encryption.encryptText(task.description, activeSSK);
            await addDoc(collection(db, 'homework'), {
              sessionId: activeSession.id,
              ownerUid: user!.uid,
              partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
              ownerUid: user!.uid,
              partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
                ownerUid: user!.uid,
                partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
    if (profile?.subscriptionTier === 'free' && activeSession.messageCount >= 40) {
      showToast(t('auth.alerts.freeLimit'), 'error');
      return;
    }

    const text = newMessage;
    setNewMessage('');

    try {
      // Encrypt message with SSK
      const encrypted = await Encryption.encryptText(text, activeSSK);

      const senderUid = user!.uid; // Always save the user account owner
      // CRITICAL: Use the logged-in user's profileId, not AI's predicted speaker
      // The person typing is defined by who is logged in, not by AI's nextSpeaker
      const senderProfileId = profile?.profileId;

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
                ownerUid: user!.uid,
                partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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

        // Auto-extract homework at checkpoints (ALL users)
        if (result.homework && result.homework.length > 0) {
          for (const task of result.homework) {
            if (!task.title || !task.description) continue;
            const encryptedTitle = await Encryption.encryptText(task.title, activeSSK);
            const encryptedDescription = await Encryption.encryptText(task.description, activeSSK);
            await addDoc(collection(db, 'homework'), {
              sessionId: activeSession.id,
              ownerUid: user!.uid,
              partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
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
              ownerUid: user!.uid,
              partnerUid: activeSession.type === 'couple' ? (profile?.partnerUid || null) : null,
              type: 'insight',
              title: encryptedHWTimelineTitle.ciphertext,
              titleIv: encryptedHWTimelineTitle.iv,
              description: encryptedHWTimelineDesc.ciphertext,
              descriptionIv: encryptedHWTimelineDesc.iv,
              createdAt: serverTimestamp()
            });
          }
        }
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
      const msgSummariesSnap = await getDocs(collection(db, 'sessions', activeSession.id, 'message_summaries'));
      for (const d of msgSummariesSnap.docs) {
        const data = d.data();
        try {
          const dec = await Encryption.decryptText({ ciphertext: data.ciphertext, iv: data.iv }, activeSSK);
          contextData.messageSummaries.push(dec);
        } catch (e) { console.error("Failed to decrypt msg summary", e); }
      }

      // 2. Get Recent Session Summaries (last 10)
      const sessionsQuery = query(
        collection(db, 'sessions'),
        or(where('ownerUid', '==', user!.uid), where('partnerUid', '==', user!.uid)),
        orderBy('createdAt', 'desc'),
        limit(AI_CONFIG.MAX_RECENT_SESSION_SUMMARIES + 1) // +1 to exclude current
      );
      const sessionsSnap = await getDocs(sessionsQuery);
      for (const d of sessionsSnap.docs) {
        if (d.id === activeSession.id) continue;
        const data = d.data();
        if (data.summary) {
          try {
            // We need the SSK for that session... this is tricky because SSK is wrapped per user.
            // For simplicity in this context, we assume the user can unwrap it if they have the CK.
            // But wait, we don't have the wrappedSSK for other sessions easily available here without fetching them.
            // Actually, we have the session data.
            const wrappedSSK = data.ownerUid === user!.uid ? data.wrappedSSK : data.partnerWrappedSSK;
            if (wrappedSSK && ck) {
              const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
              const dec = await Encryption.decryptText({ ciphertext: data.summary.ciphertext, iv: data.summary.iv }, ssk);
              contextData.sessionSummaries.push(dec);
            }
          } catch (e) { console.error("Failed to decrypt session summary", e); }
        }
      }

      // 3. Get Shared Personal Summaries (last 3) - only for couple sessions
      if (activeSession.type === 'couple') {
        const sharedQuery = query(
          collection(db, 'sessions'),
          and(
            where('type', '==', 'personal'),
            or(where('ownerUid', '==', user!.uid), where('partnerUid', '==', user!.uid)),
            where('status', 'in', ['archived', 'beeindigd']) // Assuming shared means archived or has a flag
          ),
          orderBy('createdAt', 'desc'),
          limit(AI_CONFIG.MAX_SHARED_PERSONAL_SUMMARIES)
        );
        // Note: In a real app, we'd need a 'sharedWithPartner' flag. 
        // For now, we'll assume archived personal sessions are shared if they are in the timeline.
        const sharedSnap = await getDocs(sharedQuery);
        for (const d of sharedSnap.docs) {
          const data = d.data();
          if (data.summary) {
            try {
              const wrappedSSK = data.ownerUid === user!.uid ? data.wrappedSSK : data.partnerWrappedSSK;
              if (wrappedSSK && ck) {
                const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
                const dec = await Encryption.decryptText({ ciphertext: data.summary.ciphertext, iv: data.summary.iv }, ssk);
                contextData.sharedPersonalSummaries.push(dec);
              }
            } catch (e) { console.error("Failed to decrypt shared summary", e); }
          }
        }
      }

      // 4. Get Meta Summaries (last 10)
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
        } catch (e) { console.error("Failed to decrypt meta summary", e); }
      }

      // 5. Get Last Homework
      const hwSnap = await getDocs(query(
        collection(db, 'homework'),
        where('ownerUid', '==', user!.uid),
        orderBy('createdAt', 'desc'),
        limit(1)
      ));
      if (!hwSnap.empty) {
        const data = hwSnap.docs[0].data();
        try {
          // Homework is encrypted with the session's SSK. We'd need to fetch that session's SSK.
          // For now, let's assume we can decrypt it if we have the CK.
          // Wait, homework in my previous implementation was encrypted with SSK.
          // Let's check how it's saved.
          // In handleSendMessage, it's encrypted with activeSSK.
          // So we need the SSK of the session that created the homework.
          const hwSessionDoc = await getDoc(doc(db, 'sessions', data.sessionId));
          if (hwSessionDoc.exists()) {
            const hwSessionData = hwSessionDoc.data();
            const wrappedSSK = hwSessionData.ownerUid === user!.uid ? hwSessionData.wrappedSSK : hwSessionData.partnerWrappedSSK;
            if (wrappedSSK && ck) {
              const ssk = await Encryption.unwrapKey(wrappedSSK, ck);
              const title = await Encryption.decryptText({ ciphertext: data.title, iv: data.titleIv }, ssk);
              const desc = await Encryption.decryptText({ ciphertext: data.description, iv: data.descriptionIv }, ssk);
              contextData.lastHomework = `${title}: ${desc}`;
            }
          }
        } catch (e) { console.error("Failed to decrypt homework", e); }
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

      const aiResult = await AI.generateCoachResponse(
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

      if (aiResult && aiResult.text) {
        const encryptedAi = await Encryption.encryptText(aiResult.text, activeSSK);
        await addDoc(collection(db, 'sessions', activeSession.id, 'messages'), {
          senderUid: 'ai_coach',
          content: encryptedAi.ciphertext,
          iv: encryptedAi.iv,
          createdAt: serverTimestamp(),
          role: 'assistant'
        });

        // Auto-select next speaker in couple sessions
        if (activeSession.type === 'couple' && aiResult.nextSpeaker) {
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

  if (!isPinVerified) {
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

          <div className="space-y-6">
            <input 
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              className="w-full text-center text-4xl tracking-widest py-4 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:border-emerald-500 focus:outline-none transition-colors"
              style={{ WebkitTextSecurity: 'disc' } as any}
            />
            <button 
              onClick={profile ? handleVerifyPin : handleSetupPin}
              disabled={pin.length < 4}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all"
            >
              {profile ? t('auth.unlockButton') : t('auth.initButton')}
            </button>
            <p className="text-center text-[10px] text-stone-400 uppercase tracking-widest font-bold">
              <Shield className="inline w-3 h-3 mr-1" />
              {t('auth.zeroKnowledge')}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isProfileIncomplete && view !== 'settings') {
    return (
      <div className="h-screen bg-stone-50 flex flex-col p-6 overflow-y-auto pt-safe pb-safe">
        <AnimatePresence mode="wait">
          {setupStep === 1 ? (
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

                <button 
                  onClick={() => setSetupStep(2)}
                  disabled={!profileNameInput || !partnerNameInput}
                  className="w-full bg-stone-900 text-white py-4 rounded-2xl font-bold hover:bg-stone-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {t('common.next')}
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="step2"
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
                  onClick={() => setSetupStep(1)}
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
                        {profile?.partnerUid ? (
                          t('dashboard.welcomePartner', { 
                            name: decryptedProfile.name || profile.displayName, 
                            partner: decryptedProfile.partnerName || 'Partner' 
                          })
                        ) : (
                          t('dashboard.welcome', { name: decryptedProfile.name || profile.displayName })
                        )}
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
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none"
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
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none appearance-none"
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
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none"
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
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none appearance-none"
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
                          className="w-full p-3 bg-stone-50 border border-stone-100 rounded-xl text-sm focus:border-emerald-500 focus:outline-none"
                        >
                          {getCoachesList().map(c => (
                            <option key={c.id} value={c.id}>{t(`sessions.personas.${c.id}.name`)} ({t(`sessions.personas.${c.id}.title`)})</option>
                          ))}
                        </select>
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
                      {isProfileSaving ? t('common.loading') : t('profile.saveProfile')}
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">{t('settings.partnerConnection')}</p>
                    {profile?.partnerUid ? (
                      <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm font-medium text-emerald-900">{t('settings.partnerLinked')}</span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-600">{profile.partnerUid.slice(0, 8)}...</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {partnerRequests.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-emerald-600 font-bold">{t('settings.incomingRequests')}:</p>
                            {partnerRequests.map(req => (
                              <div key={req.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl border border-stone-200">
                                <span className="text-xs text-stone-600 truncate max-w-[120px]">{req.fromEmail}</span>
                                <button 
                                  onClick={() => handleAcceptPartnerRequest(req)}
                                  className="px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-lg"
                                >
                                  {t('common.accept')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            const email = prompt(t('settings.enterPartnerEmail'));
                            if (email) handleSendPartnerRequest(email);
                          }}
                          className="w-full py-3 border-2 border-dashed border-stone-200 rounded-xl text-stone-400 text-sm font-medium hover:border-emerald-300 hover:text-emerald-600 transition-all"
                        >
                          + {t('settings.linkPartner')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {profile?.subscriptionTier === 'free' && (
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
                <p className="text-center text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                  <Shield className="inline w-3 h-3 mr-1" />
                  Restart Our Love v1.0.0
                </p>
              </div>
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
                        placeholder={activeSession.type === 'couple' 
                          ? `${selectedSpeakerUid === user.uid 
                              ? (decryptedProfile.name || t('chat.you'))
                              : (decryptedProfile.partnerName || t('chat.partner'))}: ${t('sessions.messagePlaceholder')}`
                          : t('sessions.messagePlaceholder')}
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
                        <button onClick={() => setSummary(null)} className="p-2 text-stone-400">
                          <Plus className="w-6 h-6 rotate-45" />
                        </button>
                      </div>
                      <div className="prose prose-sm prose-stone">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>
                      <button 
                        onClick={() => {
                          setSummary(null);
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
                        disabled={!profile?.partnerId}
                        className={cn(
                          "p-4 rounded-2xl border-2 transition-all text-center",
                          newSessionConfig.personalSessionOwnerId === 'partner'
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-stone-100 hover:border-stone-300",
                          !profile?.partnerId && "opacity-50 cursor-not-allowed"
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
