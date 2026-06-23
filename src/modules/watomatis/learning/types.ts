/** Editable writing-style profile extracted from the owner's own messages. */
export interface VoiceCard {
  tone: string;
  formality: 'formal' | 'semi' | 'casual';
  emojiUsage: string;
  greetings: string[];
  closings: string[];
  quirks: string[];
  /** One-paragraph persona used to instruct the agent to mimic this style. */
  summary: string;
  avgReplyChars: number;
}

export interface MinedQna {
  question: string;
  answer: string;
}
