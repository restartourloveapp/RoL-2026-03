export interface CoachPersona {
  id: string;
  type: 'solin' | 'kael' | 'ravian' | 'amari' | 'leora';
  color: string;
  icon: string;
  traits: string[];
  methods: string[];
  bio: string;
  description: string;
}

export const coaches: Record<string, CoachPersona> = {
  solin: {
    id: 'solin',
    type: 'solin',
    color: 'rose-400',
    icon: 'Heart',
    traits: ['Empathetic', 'Patient', 'Intuitive', 'Warm'],
    methods: ['EFT', 'Gottman', 'IBCT', 'ACT', 'Systemic Therapy'],
    bio: "I believe that every relationship has the potential to heal and grow. My approach is rooted in deep empathy and understanding.",
    description: "Solin focuses on emotional connection and creating a safe space for vulnerability. Perfect for couples who need to rebuild trust and intimacy."
  },
  kael: {
    id: 'kael',
    type: 'kael',
    color: 'pink-600',
    icon: 'Zap',
    traits: ['Direct', 'Action-oriented', 'Clear', 'Energetic'],
    methods: ['EFT', 'Gottman', 'IBCT', 'ACT', 'Systemic Therapy'],
    bio: "Let's stop talking in circles and start making real changes. I'm here to give you the tools and the push you need.",
    description: "Kael is a high-energy coach who prioritizes practical solutions and behavioral changes. Ideal for couples who feel stuck and want immediate action."
  },
  ravian: {
    id: 'ravian',
    type: 'ravian',
    color: 'pink-500',
    icon: 'Search',
    traits: ['Observant', 'Analytical', 'Calm', 'Insightful'],
    methods: ['EFT', 'Gottman', 'IBCT', 'ACT', 'Systemic Therapy'],
    bio: "Understanding the 'why' is the first step to changing the 'how'. I help you uncover the patterns that are holding you back.",
    description: "Ravian takes a deep dive into the dynamics of your relationship. Best for couples who want to understand their underlying patterns and history."
  },
  amari: {
    id: 'amari',
    type: 'amari',
    color: 'pink-400',
    icon: 'ShieldCheck',
    traits: ['Pragmatic', 'Values-driven', 'Flexible', 'Straightforward'],
    methods: ['EFT', 'Gottman', 'IBCT', 'ACT', 'Systemic Therapy'],
    bio: "Relationships are built on shared values and mutual respect. I help you align your actions with what truly matters to you.",
    description: "Amari focuses on building a strong foundation of values and practical communication. Great for couples looking for stability and clarity."
  },
  leora: {
    id: 'leora',
    type: 'leora',
    color: 'pink-600',
    icon: 'Trees',
    traits: ['Contextual', 'Curious', 'Systems-aware', 'Compassionate'],
    methods: ['EFT', 'Gottman', 'IBCT', 'ACT', 'Systemic Therapy'],
    bio: "No relationship exists in a vacuum. I help you see the bigger picture and how your environment shapes your connection.",
    description: "Leora looks at the systemic factors affecting your relationship. Excellent for couples dealing with external stressors or complex family dynamics."
  }
};

export const getCoach = (coachId: string) => {
  // Backward compatibility for old personas
  const idMap: Record<string, string> = {
    'Empathic': 'solin',
    'Soft': 'solin',
    'Direct': 'kael'
  };
  const mappedId = idMap[coachId] || coachId;
  return coaches[mappedId] || coaches.solin;
};

export const getCoachesList = () => Object.values(coaches);

export const getCoachAvatarUrl = (coachId: string) => {
  // Placeholder for Supabase image URL as mentioned in the request
  // For now using a consistent placeholder
  return `https://picsum.photos/seed/${coachId}/200/200`;
};
