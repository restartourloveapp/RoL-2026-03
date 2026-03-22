export interface CoachPersona {
  id: string;
  type: 'solin' | 'kael' | 'ravian' | 'amari' | 'leora';
  color: string;
  icon: string;
  avatarSmall: string; // Small coach avatar (logo)
  avatarLarge: string; // Large coach avatar (detail)
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
    avatarSmall: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fsolin_klein.png?alt=media&token=e0ede17b-1541-428d-bbc6-1d31788227b9',
    avatarLarge: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fsolin.png?alt=media&token=7afe7d13-c62a-4762-a953-ab8fe2f58d29',
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
    avatarSmall: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fkael_klein.png?alt=media&token=3dd88c8f-13cc-4158-9c72-f38dac0edb8c',
    avatarLarge: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fkael.png?alt=media&token=8d0411eb-9cb6-434d-86a2-db006dfb38bf',
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
    avatarSmall: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fravian_klein.png?alt=media&token=ac0201cb-f3ca-484a-8a20-dcc8b89d2c62',
    avatarLarge: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fravian.png?alt=media&token=4c442217-1fdb-4321-931b-80c553393099',
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
    avatarSmall: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Famari_klein.png?alt=media&token=bb6a12c8-a0ed-4293-89d0-3315d659a5af',
    avatarLarge: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Famari.png?alt=media&token=0c15bab9-ab3c-4190-b198-9b31ac7223ca',
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
    avatarSmall: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fleora_klein.png?alt=media&token=c6431528-1251-4a95-b6c5-fb5fafee4898',
    avatarLarge: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fleora.png?alt=media&token=fe2ede46-8df1-405b-9253-9bfa308b1af2',
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

// --- Logo and Image URLs ---
export const LOGO_IMAGES = {
  main_v1: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2FLogo%20hart_uitgeknipt.png?alt=media&token=d8887ff4-d127-47af-a36f-b3c33ae709a2',
  main_v2: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2FLogo%20hart_uitgeknipt2.png?alt=media&token=452d3356-14d4-4400-b53c-adbbea61c3ea',
  small: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Flogo%20balk_klein.jpg?alt=media&token=26e1cb26-886c-44ff-afce-bf1a0f8ddc55',
  header_bar: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Flogo%20balk_klein.png?alt=media&token=a6078586-75df-44af-8fb5-fef42939e0dc'
};

export const GROUP_IMAGES = {
  intro: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fgroepsafbeelding_intro.png?alt=media&token=f7f8349b-d2e1-49a2-999a-ca09a570d64f',
  small: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fgroepsafbeelding_klein.png?alt=media&token=956f6b2a-cdc4-40ad-a83c-5d6857f2b6dc',
  small_alt: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fgroepsafbeelding2_klein.jpg?alt=media&token=b78d321d-a911-4f4d-8ad7-a4efec735f95',
  large: 'https://firebasestorage.googleapis.com/v0/b/rol-2026-test.firebasestorage.app/o/avatars%2Fgroepsafbeelding2_origineel.jpeg?alt=media&token=e4b0bd3a-f97c-4f73-84e2-c07ae3a71df3'
};

export const getCoachAvatarUrl = (coachId: string, size: 'small' | 'large' = 'small') => {
  const coach = coaches[coachId];
  return coach ? (size === 'large' ? coach.avatarLarge : coach.avatarSmall) : LOGO_IMAGES.main_v1;
};
