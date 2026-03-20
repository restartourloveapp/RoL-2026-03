import { GoogleGenAI } from "@google/genai";
import { COACH_SYSTEM_PROMPTS } from "../config/prompts";
import { AI_CONFIG } from "../config/aiConfig";

export type CoachPersona = 'solin' | 'kael' | 'ravian' | 'amari' | 'leora';
export type CoachGender = 'male' | 'female';

export async function generateCoachResponse(
  persona: CoachPersona,
  gender: CoachGender,
  history: { role: 'user' | 'model', content: string }[],
  userMessage: string,
  language: string = 'nl',
  profileData?: { userName?: string, userPronouns?: string, partnerName?: string, partnerPronouns?: string },
  isCoupleSession: boolean = false,
  context?: {
    messageSummaries?: string[],
    sessionSummaries?: string[],
    sharedPersonalSummaries?: string[],
    metaSummaries?: string[],
    lastHomework?: string,
    messageCount?: number,
    isPremium?: boolean
  }
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const langKey = language === 'nl' ? 'nl' : 'en';
  const personaPrompt = COACH_SYSTEM_PROMPTS[langKey][persona];

  let profileContext = "";
  if (profileData) {
    if (profileData.userName) profileContext += `The user's name is ${profileData.userName}. `;
    if (profileData.userPronouns) profileContext += `The user's pronouns are ${profileData.userPronouns}. `;
    if (profileData.partnerName) profileContext += `The partner's name is ${profileData.partnerName}. `;
    if (profileData.partnerPronouns) profileContext += `The partner's pronouns are ${profileData.partnerPronouns}. `;
  }

  const sessionContext = isCoupleSession 
    ? "This is a COUPLE session (three-way conversation). Both partners are present. " 
    : "This is a PERSONAL session. ";

  let extraContext = "";
  if (context) {
    if (context.metaSummaries?.length) {
      extraContext += `\n[LONG-TERM PROGRESS]:\n${context.metaSummaries.join("\n")}\n`;
    }
    if (context.sessionSummaries?.length) {
      extraContext += `\n[RECENT SESSIONS]:\n${context.sessionSummaries.join("\n")}\n`;
    }
    if (context.sharedPersonalSummaries?.length) {
      extraContext += `\n[SHARED PERSONAL INSIGHTS]:\n${context.sharedPersonalSummaries.join("\n")}\n`;
    }
    if (context.sharedPersonalSummaries?.length) {
      extraContext += `\n[SHARED PERSONAL INSIGHTS]:\n${context.sharedPersonalSummaries.join("\n")}\n`;
    }
    if (context.messageSummaries?.length) {
      extraContext += `\n[EARLIER IN THIS SESSION]:\n${context.messageSummaries.join("\n")}\n`;
    }
    if (context.lastHomework) {
      extraContext += `\n[CURRENT HOMEWORK]:\n${context.lastHomework}\n`;
    }

    // Handle free tier message limits (40 messages)
    if (!context.isPremium && context.messageCount !== undefined) {
      if (context.messageCount >= 35 && context.messageCount < 40) {
        const remaining = 40 - context.messageCount;
        extraContext += `\n[LIMIT NOTICE]: The user is on a FREE plan and is approaching the session limit of 40 messages. 
        There are only ${remaining} messages left. 
        You MUST gradually start wrapping up the conversation. 
        Mention naturally that we are reaching the limit of this session and try to bring the discussion to a meaningful closing point.`;
      } else if (context.messageCount >= 40) {
        extraContext += `\n[LIMIT REACHED]: The session limit of 40 messages has been reached. 
        You MUST finalize the conversation in this message and say goodbye.`;
      }
    }
  }

  const directedQuestionInstruction = isCoupleSession
    ? "In this couple session, you MUST always direct your question to ONE specific person by name. Make it explicitly clear from whom you expect an answer. "
    : "";

  const systemInstruction = `${personaPrompt} You identify as ${gender}. 
  ${profileContext}
  ${sessionContext}
  ${extraContext}
  Always use techniques like NVC (Nonviolent Communication), Gottman micro-skills, and Imago mirroring where appropriate.
  Keep responses concise, empathetic, and focused on building communication habits.
  
  IMPORTANT RULES:
  1. Ask exactly ONE question per message.
  2. ${directedQuestionInstruction}
  3. If you detect self-harm or violence, immediately provide a crisis escalation message.
  4. You MUST respond in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.
  
  RESPONSE FORMAT:
  You MUST return a JSON object with the following structure:
  {
    "text": "Your response text in the requested language",
    "nextSpeaker": "user" | "partner" | "both" | "none"
  }
  - "user" if you are addressing ${profileData?.userName || 'the user'}.
  - "partner" if you are addressing ${profileData?.partnerName || 'the partner'}.
  - "both" if you are addressing both.
  - "none" if no specific person is addressed.`;

  const contents = [
    ...history.map(h => ({
      role: h.role,
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: userMessage }]
    }
  ];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.MODEL_NAME,
    contents,
    config: {
      systemInstruction,
      temperature: AI_CONFIG.DEFAULT_TEMPERATURE,
      responseMimeType: "application/json"
    }
  });

  const text = response.text;
  if (!text) return null;
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI response as JSON", e, text);
    return { text: text, nextSpeaker: 'none' };
  }
}

export async function generateResponseTip(
  history: { role: 'user' | 'model', content: string }[],
  language: string = 'nl'
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const systemInstruction = `You are a relationship communication expert. 
  Based on the following conversation history, suggest ONE brief, actionable response for the user.
  Use techniques like:
  - NVC (Nonviolent Communication): "I feel [feeling] because I need [need]. Would you be willing to [request]?"
  - Imago Mirroring: "What I hear you saying is... Did I get that right? Is there more?"
  - Softened Startup: Bringing up a concern without blame.
  Focus on empathy and connection. Keep it under 50 words.
  IMPORTANT: You MUST respond in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.`;

  const contents = [
    ...history.map(h => ({
      role: h.role,
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: "I'm not sure how to respond to this. Can you give me a tip?" }]
    }
  ];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.MODEL_NAME,
    contents,
    config: {
      systemInstruction,
      temperature: 0.7,
    }
  });

  return response.text;
}

export async function generateSummary(
  history: { role: 'user' | 'model', content: string }[],
  language: string = 'nl',
  isPremium: boolean = false
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  let ctaInstruction = "";
  if (!isPremium) {
    ctaInstruction = `
    IMPORTANT: Since this is a FREE session, you should naturally weave in the benefits of our Premium journey at the end of the summary. 
    Instead of a formal "Call to Action", mention how much more we could achieve with deeper pattern analysis, structured exercises, 
    and a permanent timeline for tracking these breakthroughs. Make it feel like a supportive suggestion for their long-term relationship health.
    `;
  }

  const systemInstruction = `You are a relationship expert and coach. Analyze this conversation and provide a deep, insightful summary of the progress made.
  Additionally, identify if any significant milestones, insights, or breakthroughs (Timeline Entries) occurred, 
  or if any specific tasks or exercises (Homework) were suggested.
  
  ${ctaInstruction}

  Return a JSON object with the following structure:
  {
    "summary": "The Markdown summary text (deeply insightful, highlighting emotional shifts and communication patterns)",
    "timelineEntries": [
      { "title": "...", "description": "...", "type": "milestone" | "insight" | "breakthrough" }
    ],
    "homework": [
      { "title": "...", "description": "...", "dueDate": "ISO Date String (optional)" }
    ]
  }
  
  Focus on:
  1. Main communication challenges identified (e.g., specific 'Four Horsemen' behaviors).
  2. Positive progress or 'micro-wins' (e.g., successful softened startups, successful mirroring).
  3. Actionable homework or next steps suggested (e.g., 'The Daily 6-Second Kiss', 'Weekly State of the Union').
  4. Deeper insights into attachment styles or underlying emotional needs.
  Keep it structured, encouraging, and deeply professional.
  IMPORTANT: All text fields in the JSON response (summary, title, description) MUST be in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.`;

  const contents = [
    ...history.map(h => ({
      role: h.role,
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: "Please provide a summary of our progress so far, including any milestones or homework." }]
    }
  ];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.MODEL_NAME,
    contents,
    config: {
      systemInstruction,
      temperature: 0.5,
      responseMimeType: "application/json"
    }
  });

  const text = response.text;
  if (!text) return null;
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI summary as JSON", e, text);
    return { summary: text, timelineEntries: [], homework: [] };
  }
}

export async function generateMessageSummary(
  messages: { role: 'user' | 'model', content: string }[],
  language: string = 'nl'
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const systemInstruction = `Summarize the following conversation block in a few concise sentences. 
  Focus on the main topics discussed and the emotional tone. 
  This summary will be used as context for future messages.
  Language: ${language === 'nl' ? 'Dutch' : 'English'}`;

  const response = await ai.models.generateContent({
    model: AI_CONFIG.MODEL_NAME,
    contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
    config: { systemInstruction, temperature: AI_CONFIG.SUMMARY_TEMPERATURE }
  });

  return response.text;
}

export async function generateMetaSummary(
  summaries: string[],
  language: string = 'nl'
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const systemInstruction = `The following are summaries of previous coaching sessions. 
  Create a single "meta-summary" that captures the long-term progress, recurring themes, and major breakthroughs.
  Keep it concise but deeply insightful.
  Language: ${language === 'nl' ? 'Dutch' : 'English'}`;

  const response = await ai.models.generateContent({
    model: AI_CONFIG.MODEL_NAME,
    contents: [{ role: 'user', parts: [{ text: summaries.join("\n\n---\n\n") }] }],
    config: { systemInstruction, temperature: AI_CONFIG.SUMMARY_TEMPERATURE }
  });

  return response.text;
}

