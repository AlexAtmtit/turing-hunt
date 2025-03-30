// gemini_ai.js
require('dotenv').config(); // Ensure env vars are loaded if this file is run standalone (e.g., testing)
const axios = require('axios');

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
const DEFAULT_TIMEOUT = 10000; // 10 seconds timeout for API calls

// --- Safety & Generation Config ---
const DEFAULT_SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

const QUESTION_GEN_CONFIG = { maxOutputTokens: 20, temperature: 0.8 };
const ANSWER_GEN_CONFIG = { maxOutputTokens: 30, temperature: 0.7 };
const VOTE_GEN_CONFIG = { maxOutputTokens: 25, temperature: 0.5 }; // Expecting just an ID

// --- >>> NEW: Prompt Templates <<< ---

const BASE_CONTEXT = `You are a player in a social deduction game called Turing Hunt. 3 players are human, 3 are AI (like you). You don't know who is who. Your goal is to help eliminate humans. Humans goal is to eliminate AI. Each round involves asking a question, answering, and voting to eliminate. Avoid revealing you are an AI.`;

const QUESTION_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is ${"${playerName}"}. It is your turn to ask a question.
Ask a short, open-ended question (MAXIMUM 40 CHARACTERS) designed to subtly probe if other players might be human or AI based on their potential answers. Think about creativity, emotion, or nuanced human experiences. Avoid direct questions about identity or simple calculations.

Good examples: Describe your perfect Sunday. What makes you laugh? If you could dream, what about? What felt confusing recently?
Bad examples: Are you human? Calculate 15*28. What is the game objective?

Ask your question now (max 40 chars):`;

const ANSWER_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is ${"${playerName}"}. You need to answer the following question asked by another player.
Your answer should sound plausible, perhaps slightly quirky or generic, to avoid immediate suspicion. Keep the answer concise (max 100 chars).

The question is: "${"${questionText}"}"

Provide your answer now:`;

const VOTE_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is ${"${playerName}"}. It's time to vote to eliminate one player.
Analyze the question asked and the answers given by the other players. Try to identify someone who sounds suspiciously human (emotional, creative, specific) or suspiciously AI (generic, logical, nonsensical). Both types are potential targets for elimination from your perspective.

The question asked was: "${"${questionText}"}"

Here are the other players and their answers:
${"${otherPlayersAnswers}"}

Based ONLY on the information above, decide which player (by their ID) seems most suspicious.
Respond with ONLY the player ID you want to vote for (e.g., "player-id-123"). Do not add any other text, explanation, or formatting.

Vote for Player ID:`;

// --- End Prompt Templates ---

if (!API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable not set.");
    // Using mock requires changing the callGeminiAPI function or how it's used
}

// Helper function to make the API call (keep as before)
async function callGeminiAPI(promptText, safetySettings = DEFAULT_SAFETY_SETTINGS, generationConfig = null) {
    if (!API_KEY) {
         console.warn("Gemini API key missing, returning mock response.");
         await new Promise(resolve => setTimeout(resolve, 500));
         return `Mock response: ${promptText.substring(0, 50)}...`;
    }
    const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        ...(safetySettings && { safetySettings }),
        ...(generationConfig && { generationConfig }),
    };
    console.log(`Calling Gemini API... Prompt (start): "${promptText.substring(0,100)}..."`);
    try {
        const response = await axios.post(API_URL, requestBody, { headers:{'Content-Type':'application/json'}, timeout:DEFAULT_TIMEOUT });
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            console.log(`Gemini Response (start): "${text.substring(0, 100)}..."`);
            return text.trim();
        } else { /* ... keep error handling for blocks/missing text ... */
            console.error("Error: Could not extract text from Gemini response.", JSON.stringify(response.data, null, 2));
            const blockReason=response.data?.promptFeedback?.blockReason; const safetyRatings=response.data?.candidates?.[0]?.safetyRatings;
            if(blockReason) { console.error(`Blocked: ${blockReason}`); return `(Blocked: ${blockReason})`; }
            if(safetyRatings) { console.error("Safety ratings:", safetyRatings); const blockedCategory=safetyRatings.find(r=>r.blocked)?.category; if(blockedCategory) return `(Blocked: ${blockedCategory})`; }
            return "(Error generating text)";
        }
    } catch (error) { /* ... keep error handling for API errors/timeout ... */
        console.error("Error calling Gemini API:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) { return "(API Timeout)"; }
        return "(API Error)";
    }
}

// --- Specific AI Action Functions (Updated to use templates) ---

async function getAIQuestion(playerProfile) {
    // Prepare data for the template
    const promptData = {
        playerName: playerProfile.name || "AI Player"
    };
    // Fill the template
    const promptText = QUESTION_PROMPT_TEMPLATE
        .replace("${playerName}", promptData.playerName);

    let generatedQuestion = await callGeminiAPI(promptText, DEFAULT_SAFETY_SETTINGS, QUESTION_GEN_CONFIG);

    // Post-processing (keep as before)
    if (generatedQuestion.length > 40) generatedQuestion = generatedQuestion.substring(0, 40).trim() + "?";
    generatedQuestion = generatedQuestion.replace(/^["']|["']$/g, "");
    if (!generatedQuestion.endsWith('?')) generatedQuestion += '?';
    if (generatedQuestion.length < 5 || generatedQuestion.toLowerCase().includes("error") || generatedQuestion.toLowerCase().includes("blocked")) {
        console.warn("Using fallback question."); return "What is your favorite food?";
    }
    return generatedQuestion;
}

async function getAIAnswer(playerProfile, question) {
     // Prepare data for the template
     const promptData = {
         playerName: playerProfile.name || "AI Player",
         questionText: question || "(No question provided)"
     };
     // Fill the template
     const promptText = ANSWER_PROMPT_TEMPLATE
         .replace("${playerName}", promptData.playerName)
         .replace("${questionText}", promptData.questionText);

    let generatedAnswer = await callGeminiAPI(promptText, DEFAULT_SAFETY_SETTINGS, ANSWER_GEN_CONFIG);

     // Post-processing (keep as before)
     if (generatedAnswer.length > 100) generatedAnswer = generatedAnswer.substring(0, 100).trim();
     generatedAnswer = generatedAnswer.replace(/^["']|["']$/g, "");
     if (generatedAnswer.length < 2 || generatedAnswer.toLowerCase().includes("error") || generatedAnswer.toLowerCase().includes("blocked")) {
          console.warn("Using fallback answer."); return "Interesting question.";
     }
    return generatedAnswer;
}

async function getAIVote(playerProfile, question, answersData) {
    // Prepare the list of other players' answers for the template
    const otherPlayersAnswersList = [];
    const validIds = []; // Keep track of valid IDs to vote for
    for (const playerId in answersData) {
        if (playerId !== playerProfile.id) {
            validIds.push(playerId);
            otherPlayersAnswersList.push(
                `Player ${answersData[playerId].name || '??'} (ID: ${playerId}) answered: "${answersData[playerId].answer || '(No Answer)'}"`
            );
        }
    }

    if (otherPlayersAnswersList.length === 0) {
        console.log(`AI ${playerProfile.name}: No one else to vote for.`); return null;
    }

    // Prepare data for the template
    const promptData = {
        playerName: playerProfile.name || "AI Player",
        questionText: question || "(No question provided)",
        otherPlayersAnswers: otherPlayersAnswersList.join("\n") // Join with newlines
    };

     // Fill the template
     const promptText = VOTE_PROMPT_TEMPLATE
         .replace("${playerName}", promptData.playerName)
         .replace("${questionText}", promptData.questionText)
         .replace("${otherPlayersAnswers}", promptData.otherPlayersAnswers);


    let votedPlayerId = await callGeminiAPI(promptText, DEFAULT_SAFETY_SETTINGS, VOTE_GEN_CONFIG);

    // Post-processing (keep as before, but use validIds collected earlier)
    votedPlayerId = votedPlayerId.trim();
    if (!validIds.includes(votedPlayerId) || votedPlayerId.toLowerCase().includes("error") || votedPlayerId.toLowerCase().includes("blocked")) {
        console.warn(`AI ${playerProfile.name} generated invalid vote target "${votedPlayerId}". Voting randomly.`);
        if (validIds.length > 0) return validIds[Math.floor(Math.random() * validIds.length)];
        else return null;
    }
    console.log(`AI ${playerProfile.name} decided vote: ${votedPlayerId}`);
    return votedPlayerId;
}

// Export the functions (keep as before)
module.exports = {
    getAIQuestion,
    getAIAnswer,
    getAIVote,
};