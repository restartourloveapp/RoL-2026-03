export const CRISIS_KEYWORDS = [
  'suicide', 'kill myself', 'end my life', 'better off dead', 'hurt myself',
  'self-harm', 'cutting', 'overdose', 'jump off', 'hanging',
  'domestic violence', 'hitting me', 'abusing me', 'scared for my life',
  'threatened me', 'sexual assault', 'raped', 'molested'
];

export const detectCrisis = (text: string): boolean => {
  const lowerText = text.toLowerCase();
  return CRISIS_KEYWORDS.some(keyword => lowerText.includes(keyword));
};

export const getCrisisResources = () => {
  return [
    {
      name: "National Suicide Prevention Lifeline",
      phone: "988",
      website: "https://988lifeline.org",
      category: "suicide",
      description: "24/7, free and confidential support for people in distress."
    },
    {
      name: "Crisis Text Line",
      phone: "Text HOME to 741741",
      website: "https://www.crisistextline.org",
      category: "mental_health",
      description: "Connect with a volunteer Crisis Counselor."
    },
    {
      name: "National Domestic Violence Hotline",
      phone: "1-800-799-SAFE (7233)",
      website: "https://www.thehotline.org",
      category: "domestic_violence",
      description: "Confidential support for anyone experiencing domestic violence."
    },
    {
      name: "RAINN (National Sexual Assault Hotline)",
      phone: "1-800-656-HOPE (4673)",
      website: "https://www.rainn.org",
      category: "general",
      description: "Support for survivors of sexual assault."
    }
  ];
};
