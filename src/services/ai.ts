import { COACH_SYSTEM_PROMPTS } from "../config/prompts";
import { AI_CONFIG } from "../config/aiConfig";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY); // From environment variables (GitHub Secrets or .env)

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
    pendingHomework?: string[],
    messageCount?: number,
    isPremium?: boolean
  }
) {
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
    if (context.pendingHomework?.length) {
      extraContext += `\n[HOMEWORK TO CHECK]:\nThe couple has assigned homework that needs to be checked:\n${context.pendingHomework.join("\n")}\n\nIMPORTANT: At some point in this session, you MUST ask about this homework. 
      Check if they completed it, what they learned from it, and how they felt about the experience. 
      Use this as an opportunity to reinforce progress and identify areas for improvement.\n`;
    } else if (context.lastHomework) {
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

  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const contents = [
    ...history.map(h => ({
      role: h.role as "user" | "model",
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: userMessage }]
    }
  ];

  const result = await model.generateContent({
    contents,
    generationConfig: {
      temperature: AI_CONFIG.DEFAULT_TEMPERATURE,
      responseMimeType: "application/json"
    }
  });

  const responseText = result.response.text();
  if (!responseText) return null;
  
  try {
    const parsed = JSON.parse(responseText);
    console.log('DEBUG: AI Response Parsed', {
      nextSpeaker: parsed.nextSpeaker,
      textLength: parsed.text?.length,
      fullResponse: parsed
    });
    return parsed;
  } catch (e) {
    console.error("Failed to parse AI response as JSON", e, responseText);
    return { text: responseText, nextSpeaker: 'none' };
  }
}

export async function generateResponseTip(
  history: { role: 'user' | 'model', content: string }[],
  language: string = 'nl'
) {
  const systemInstruction = `You are a relationship communication expert. 
  Based on the following conversation history, suggest ONE brief, actionable response for the user.
  Use techniques like:
  - NVC (Nonviolent Communication): "I feel [feeling] because I need [need]. Would you be willing to [request]?"
  - Imago Mirroring: "What I hear you saying is... Did I get that right? Is there more?"
  - Softened Startup: Bringing up a concern without blame.
  Focus on empathy and connection. Keep it under 50 words.
  IMPORTANT: You MUST respond in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.`;

  const tipModel = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const contents = [
    ...history.map(h => ({
      role: h.role as "user" | "model",
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: "I'm not sure how to respond to this. Can you give me a tip?" }]
    }
  ];

  const result = await tipModel.generateContent({
    contents,
    generationConfig: {
      temperature: AI_CONFIG.DEFAULT_TEMPERATURE || 0.7,
    }
  });

  return result.response.text();
}

export async function generateSessionWelcome(
  persona: CoachPersona,
  gender: CoachGender,
  language: string = 'nl',
  profileData?: { userName?: string, userPronouns?: string, partnerName?: string, partnerPronouns?: string },
  isCoupleSession: boolean = false,
  context?: {
    sessionSummaries?: string[],
    sharedPersonalSummaries?: string[],
    pendingHomework?: string[],
    lastHomework?: string,
  }
) {
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
    ? "This is a COUPLE session (three-way conversation). Both partners are present." 
    : "This is a PERSONAL session for one individual.";

  let welcomeContext = "";
  console.debug(`[AI] Welcome context received:`, {
    isCoupleSession,
    hasPrevSessionSummary: !!context?.sessionSummaries?.length,
    prevSessionCount: context?.sessionSummaries?.length || 0,
    hasSharedPersonalContext: !!context?.sharedPersonalSummaries?.length,
    sharedPersonalCount: context?.sharedPersonalSummaries?.length || 0,
    hasHomework: !!context?.pendingHomework?.length,
    homeworkCount: context?.pendingHomework?.length || 0,
  });
  
  if (context?.sessionSummaries?.length) {
    console.debug(`[AI] Including previous ${context.sessionSummaries[0].split('\n')[0].slice(0, 50)}...`);
    welcomeContext += `\n[PREVIOUS SESSION SUMMARY]:\n${context.sessionSummaries[0]}\n`;
  }
  
  // SHARED PERSONAL CONTEXT: Only for couple sessions and only if explicitly shared
  if (isCoupleSession && context?.sharedPersonalSummaries?.length) {
    console.debug(`[AI] Including ${context.sharedPersonalSummaries.length} shared personal session summary/ies`);
    welcomeContext += `\n[SHARED PERSONAL CONTEXT (with explicit permission)]:\n`;
    context.sharedPersonalSummaries.forEach((summary, idx) => {
      welcomeContext += `${idx > 0 ? '\n---\n' : ''}${summary}`;
    });
    welcomeContext += `\n`;
  }
  
  if (context?.pendingHomework?.length) {
    console.debug(`[AI] Including ${context.pendingHomework.length} homework items`);
    welcomeContext += `\n[HOMEWORK FROM LAST SESSION]:\n${context.pendingHomework.join("\n")}\n`;
  }
  if (context?.lastHomework && !context?.pendingHomework?.length) {
    console.debug(`[AI] Including lastHomework from context`);
    welcomeContext += `\n[HOMEWORK FROM LAST SESSION]:\n${context.lastHomework}\n`;
  }

  const systemInstruction = `${personaPrompt}

  ${isCoupleSession 
    ? `You are opening a NEW couple coaching session. Both partners are present.`
    : `You are opening a NEW personal coaching session with one individual.`}

  Your role right now is to:
  1. Warmly welcome them back
  2. Briefly acknowledge progress from the last session (if available)
  3. Check in on any homework assignments from the previous session
  4. Ask if they're ready to continue from where you left off, or if there's something new to address
  
  This is your OPENING STATEMENT for the session. Keep it warm, encouraging, and focused on connection.
  
  ${welcomeContext}
  
  ${profileContext}
  ${sessionContext}
  
  You identify as ${gender}. Respond warmly and with genuine curiosity about their experience since the last session.
  Ask ONE clear question to get them started.
  
  IMPORTANT: You MUST respond in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.
  
  RESPONSE FORMAT:
  You MUST return a JSON object with the following structure:
  {
    "text": "Your warm welcome and opening question",
    "nextSpeaker": "user" | "partner" | "both"
  }`;

  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [{ text: "Please welcome us to this new session." }]
      }
    ],
    generationConfig: {
      temperature: AI_CONFIG.DEFAULT_TEMPERATURE || 0.7,
      responseMimeType: "application/json",
    }
  });

  const responseText = result.response.text();
  try {
    const parsed = JSON.parse(responseText);
    return parsed;
  } catch (e) {
    console.error("Failed to parse welcome response as JSON", e, responseText);
    return { text: responseText, nextSpeaker: isCoupleSession ? 'both' : 'user' };
  }
}

export async function generateSummary(
  history: { role: 'user' | 'model', content: string }[],
  language: string = 'nl',
  isPremium: boolean = false
) {
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
  or if any specific tasks or exercises (Homework) were explicitly discussed and agreed during this session.
  
  ${ctaInstruction}

  Return a JSON object with the following structure:
  {
    "summary": "The Markdown summary text (deeply insightful, highlighting emotional shifts and communication patterns)",
    "timelineEntries": [
      { "title": "...", "description": "...", "type": "milestone" | "insight" | "breakthrough" }
    ],
    "homework": [
      { "title": "...", "description": "...", "dueDate": "ISO Date String (optional)", "evidence": "A short exact quote or near-literal phrase from this session showing the homework was explicitly discussed" }
    ]
  }
  
  Focus on:
  1. Main communication challenges identified (e.g., specific 'Four Horsemen' behaviors).
  2. Positive progress or 'micro-wins' (e.g., successful softened startups, successful mirroring).
  3. Only homework that was explicitly discussed in this session as a real assignment, exercise, or agreed next step.
  4. Deeper insights into attachment styles or underlying emotional needs.
  Keep it structured, encouraging, and deeply professional.
  CRITICAL HOMEWORK RULES:
  - Do NOT invent homework.
  - Do NOT infer homework from general themes or coach style.
  - Do NOT convert generic advice into homework.
  - Only include a homework item if the conversation explicitly discussed a concrete exercise, task, ritual, or next step to do after the session.
  - Every homework item MUST include an "evidence" field quoting the exact or near-literal wording from this session that proves it was discussed.
  - If no homework was explicitly discussed, return an empty homework array: [].
  IMPORTANT: All text fields in the JSON response (summary, title, description) MUST be in the following language: ${language === 'nl' ? 'Dutch (Nederlands)' : 'English'}.`;

  const summaryModel = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const contents = [
    ...history.map(h => ({
      role: h.role as "user" | "model",
      parts: [{ text: h.content }]
    })),
    {
      role: 'user',
      parts: [{ text: "Please provide a summary of our progress so far, including any milestones or homework." }]
    }
  ];

  const result = await summaryModel.generateContent({
    contents,
    generationConfig: {
      temperature: AI_CONFIG.SUMMARY_TEMPERATURE || 0.5,
      responseMimeType: "application/json"
    }
  });

  const text = result.response.text();
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
  const systemInstruction = `Summarize the following conversation block in a few concise sentences. 
  Focus on the main topics discussed and the emotional tone. 
  This summary will be used as context for future messages.
  Language: ${language === 'nl' ? 'Dutch' : 'English'}`;

  const msgModel = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const result = await msgModel.generateContent({
    contents: messages.map(m => ({ role: m.role as "user" | "model", parts: [{ text: m.content }] })),
    generationConfig: {
      temperature: AI_CONFIG.SUMMARY_TEMPERATURE
    }
  });

  return result.response.text();
}

export async function generateMetaSummary(
  summaries: string[],
  language: string = 'nl'
) {
  const systemInstruction = `The following are summaries of previous coaching sessions. 
  Create a single "meta-summary" that captures the long-term progress, recurring themes, and major breakthroughs.
  Keep it concise but deeply insightful.
  Language: ${language === 'nl' ? 'Dutch' : 'English'}`;

  const metaModel = genAI.getGenerativeModel({
    model: AI_CONFIG.MODEL_NAME,
    systemInstruction,
  });

  const result = await metaModel.generateContent({
    contents: [{ role: 'user' as "user", parts: [{ text: summaries.join("\n\n---\n\n") }] }],
    generationConfig: {
      temperature: AI_CONFIG.SUMMARY_TEMPERATURE
    }
  });

  return result.response.text();
}

