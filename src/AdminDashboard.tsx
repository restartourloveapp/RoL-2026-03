import React, { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import {
  Shield,
  ShieldAlert,
  LogOut,
  Paperclip,
  Heart,
  LifeBuoy,
  CheckCircle,
  Clock,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

interface Ticket {
  id: string;
  userUid: string;
  subject: string;
  description: string;
  plaintextSnippet?: string;
  fileUrl?: string;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: { seconds: number };
}

interface CrisisResource {
  id: string;
  name: string;
  phone?: string;
  website?: string;
  description: string;
  category: string;
}

interface AdminDashboardProps {
  userEmail: string;
}

export default function AdminDashboard({ userEmail }: AdminDashboardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [crisisResources, setCrisisResources] = useState<CrisisResource[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Tickets listener
  useEffect(() => {
    const q = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ticket)));
    }, (error) => {
      console.error('Admin tickets error:', error);
    });
    return unsub;
  }, []);

  // Crisis resources listener
  useEffect(() => {
    const q = query(collection(db, 'crisis_resources'));
    const unsub = onSnapshot(q, (snap) => {
      setCrisisResources(snap.docs.map(d => ({ id: d.id, ...d.data() } as CrisisResource)));
    }, (error) => {
      console.error('Admin crisis resources error:', error);
    });
    return unsub;
  }, []);

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
    showToast('Crisis resources seeded successfully', 'success');
  };

  const updateTicketStatus = async (ticketId: string, status: string) => {
    await updateDoc(doc(db, 'tickets', ticketId), { status });
    showToast(`Ticket marked as ${status}`, 'success');
  };

  const filteredTickets = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
  const openCount = tickets.filter(t => t.status === 'open').length;
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <header className="bg-stone-900 text-white p-6 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-stone-800 rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold">Admin Dashboard</h1>
              <p className="text-stone-400 text-sm">{userEmail}</p>
            </div>
          </div>
          <button 
            onClick={() => signOut(auth)}
            className="flex items-center gap-2 px-4 py-2 bg-stone-800 rounded-xl text-sm font-bold hover:bg-stone-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Uitloggen
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Open</span>
            </div>
            <p className="text-3xl font-bold text-stone-900">{openCount}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-5 h-5 text-amber-500" />
              <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">In Progress</span>
            </div>
            <p className="text-3xl font-bold text-stone-900">{inProgressCount}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">Resolved</span>
            </div>
            <p className="text-3xl font-bold text-stone-900">{resolvedCount}</p>
          </div>
        </div>

        {/* Tickets Section */}
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100 flex items-center justify-between">
            <h2 className="font-serif font-bold text-xl text-stone-900 flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-stone-600" />
              Support Tickets
            </h2>
            <div className="flex gap-2">
              {(['all', 'open', 'in_progress', 'resolved'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors",
                    filter === f 
                      ? "bg-stone-900 text-white" 
                      : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                  )}
                >
                  {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-stone-400 text-sm">No tickets found</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {filteredTickets.map(ticket => (
                <div key={ticket.id} className="p-6 hover:bg-stone-50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full",
                        ticket.status === 'open' ? "bg-red-100 text-red-700" :
                        ticket.status === 'in_progress' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                      )}>
                        {ticket.status === 'in_progress' ? 'In Progress' : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                      </span>
                      <span className="text-xs text-stone-400">
                        {ticket.createdAt?.seconds 
                          ? new Date(ticket.createdAt.seconds * 1000).toLocaleString('nl-NL') 
                          : 'Unknown date'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-stone-300">{ticket.id.slice(0, 8)}</span>
                  </div>

                  <h3 className="font-bold text-stone-900 text-lg mb-1">{ticket.subject}</h3>
                  <p className="text-sm text-stone-600 mb-4">{ticket.description}</p>

                  {ticket.plaintextSnippet && (
                    <div className="p-3 bg-stone-50 rounded-xl border border-stone-100 mb-4">
                      <p className="text-[10px] text-stone-400 font-bold uppercase mb-1">Chat Context:</p>
                      <pre className="text-[11px] text-stone-600 whitespace-pre-wrap font-mono">
                        {ticket.plaintextSnippet}
                      </pre>
                    </div>
                  )}

                  {ticket.fileUrl && (
                    <a 
                      href={ticket.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-xs text-emerald-700 font-bold mb-4"
                    >
                      <Paperclip className="w-4 h-4" />
                      View Attachment
                    </a>
                  )}

                  <div className="flex gap-2">
                    {ticket.status !== 'in_progress' && (
                      <button 
                        onClick={() => updateTicketStatus(ticket.id, 'in_progress')}
                        className="px-4 py-2 bg-amber-100 text-amber-700 text-xs font-bold rounded-xl hover:bg-amber-200 transition-colors"
                      >
                        Mark In Progress
                      </button>
                    )}
                    {ticket.status !== 'resolved' && (
                      <button 
                        onClick={() => updateTicketStatus(ticket.id, 'resolved')}
                        className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                    {ticket.status === 'resolved' && (
                      <button 
                        onClick={() => updateTicketStatus(ticket.id, 'open')}
                        className="px-4 py-2 bg-stone-100 text-stone-600 text-xs font-bold rounded-xl hover:bg-stone-200 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3 inline mr-1" />
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Crisis Resources Section */}
        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100 flex items-center justify-between">
            <h2 className="font-serif font-bold text-xl text-stone-900 flex items-center gap-3">
              <LifeBuoy className="w-5 h-5 text-red-500" />
              Crisis Resources ({crisisResources.length})
            </h2>
            <button 
              onClick={seedCrisisResources}
              className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Seed Resources
            </button>
          </div>

          {crisisResources.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-stone-400 text-sm">No crisis resources configured</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-100">
              {crisisResources.map(resource => (
                <div key={resource.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-stone-900">{resource.name}</p>
                    <p className="text-sm text-stone-500">{resource.description}</p>
                  </div>
                  <div className="text-right text-sm">
                    {resource.phone && <p className="text-stone-700 font-mono">{resource.phone}</p>}
                    <span className="text-[9px] font-bold text-stone-400 uppercase">{resource.category}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl text-sm font-bold z-50",
              toast.type === 'success' ? "bg-emerald-600 text-white" :
              toast.type === 'error' ? "bg-red-600 text-white" : "bg-stone-800 text-white"
            )}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
