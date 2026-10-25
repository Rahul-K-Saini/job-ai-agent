// Settings for the apply flow. Separate from config.js so your tuned selectors there stay untouched.
export const applyConfig = {
  maxAppliesPerRun: 5,       // hard cap on successful applications per run
  minScore: 70,              // only jobs at/above this Gemini score are offered
  factsFile: "facts.json",   // your answers to common screening questions
  autoAcceptAnswers: false,  // true = accept Gemini's confident answers without asking (not recommended at first)
};

// Selectors for Naukri's apply flow. These are best guesses and may need tuning with DevTools.
// If any of them fail, the agent hands the page over to you instead of guessing.
export const APPLY_SEL = {
  applyFallback: "#apply-button",
  chatDrawer: "[class*='chatbot_Drawer'], [class*='chatbot_Container'], [class*='chatbot']",
  botMessage: "[class*='botMsg'], [class*='botItem']",
  chatOption: "[class*='chatbot'] [class*='chip'], [class*='chatbot'] label",
  chatInput:
    "[class*='chatbot'] [contenteditable='true'], [class*='chatbot'] textarea, [class*='chatbot'] input[type='text']",
  chatSend:
    "[class*='chatbot'] [class*='sendMsg'], [class*='chatbot'] button:has-text('Save'), [class*='chatbot'] button:has-text('Send')",
  successText: /successfully applied|application (has been )?(sent|submitted)/i,
};
