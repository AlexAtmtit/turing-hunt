// server.js
require('dotenv').config(); // Needs to be at the VERY TOP

// Imports (keep express, http, path, Server)
const express = require('express'); const http = require('http'); const path = require('path'); const { Server } = require("socket.io");
const axios = require('axios'); // Axios might be needed here if not solely in gemini_ai.js

// --- >>> Import AI module AND prompt arrays <<< ---
const aiController = require('./gemini_ai');
const { QUESTION_PROMPTS, ANSWER_PROMPTS } = aiController; // Import the arrays
// --- >>> END Import <<< ---


// Init, Port, Middleware, Helpers, Constants (keep as before)
const app = express(); const server = http.createServer(app); const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
/* ... keep generateUniqueName, generateAvatarData, shuffleArray ... */
const ADJECTIVES = ["Quick", "Lazy", "Sleepy", "Noisy", "Hungry", "Clever", "Brave", "Shiny", "Happy", "Grumpy"]; const NOUNS = ["Fox", "Dog", "Cat", "Mouse", "Bear", "Lion", "Tiger", "Robot", "Alien", "Ghost"]; const usedNames = new Set(); function generateUniqueName() { let n,a=0; do { const j=ADJECTIVES[~~(Math.random()*ADJECTIVES.length)],o=NOUNS[~~(Math.random()*NOUNS.length)]; n=`${j}${o}${ ~~(Math.random()*100)}`; a++; } while(usedNames.has(n) && a<50); usedNames.add(n); return n;} const SHAPES=['circle','square','triangle']; const COLORS=['#FF6B6B', '#4ECDC4', '#45B7D1', '#FED766', '#8AEEF4', '#F8AFA6', '#F1EFA5', '#ABE9B3']; function generateAvatarData(){return{shape:SHAPES[~~(Math.random()*SHAPES.length)],color1:COLORS[~~(Math.random()*COLORS.length)],color2:COLORS[~~(Math.random()*COLORS.length)],eyeStyle:Math.random()>0.5?'dots':'lines'};} function shuffleArray(a){for(let i=a.length-1;i>0;i--){const j=~~(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}}
const MAX_PLAYERS_FOR_GAME = 3; const DEFAULT_AI_PLAYER_COUNT = 3; const SOLO_AI_PLAYER_COUNT = 5; const TOTAL_PLAYERS_MULTIPLAYER = MAX_PLAYERS_FOR_GAME + DEFAULT_AI_PLAYER_COUNT; const TOTAL_PLAYERS_SOLO = 1 + SOLO_AI_PLAYER_COUNT; const ROUND_PHASE_DURATION = { ASKING: 30, ANSWERING: 30, VOTING: 30, REVEAL: 5 }; const QUESTION_MAX_LENGTH = 40; const ANSWER_MAX_LENGTH = 100; const SOLO_TARGET_ROUNDS = 3;

// Server State (keep as before)
const waitingPlayers = new Set(); const activeGames = new Map(); let nextGameId = 1;

// --- >>> NEW: Emoji List <<< ---
const EMOJI_AVATARS = [
    // People (Simplified)
    '😀', '😎', '🥸', '🧐', '🧑‍💻', '🧑‍🎨', '🧑‍🚀', '🧑‍🚒', '👮', '🕵️', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟',
    // Animals
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦄',
    // Objects & Misc
    '⭐', '🌟', '🌈', '❤️', '💖', '✨', '🎮', '🎨', '🎭', '🚀', '💡', '💎'
];

// Replace generateAvatarData with generateEmojiAvatar
function generateEmojiAvatar() {
    return EMOJI_AVATARS[Math.floor(Math.random() * EMOJI_AVATARS.length)];
}

// Helper function to generate Socket.io-like IDs
function generateSocketLikeId() {
    // Socket.io IDs are typically 12-16 characters
    const length = 12;
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// --- >>> NEW: Message Moderation <<< ---

/**
 * Strict English language detection
 * Checks if text contains almost exclusively Latin characters
 */
function isLikelyEnglish(text) {
  // No exemption for short texts - check all text regardless of length
  if (!text || typeof text !== 'string') return false; // Basic validation

  // Count non-Latin characters (allows basic Latin, numbers, punctuation and common symbols)
  const nonLatinCharCount = text.replace(/[a-zA-Z0-9\s.,!?;:'"()&$#@%*+-]/g, '').length;

  // Handle potential division by zero for empty strings after replacement
  if (text.length === 0) return true; // Consider empty string as "English" for this check

  // If more than 1% of characters are non-Latin, probably not English
  // This is a very strict check that requires almost exclusively Latin characters
  return (nonLatinCharCount / text.length) < 0.01;
}

// Comprehensive list of inappropriate words, including variations and substitutions
const INAPPROPRIATE_WORDS = [
  // Common profanity
  'fuck', 'fuk', 'fck', 'fuq', 'f*ck', 'f**k', 'f@ck', 'fu*k', 'phuck', 'fvck',
  'shit', 'sh*t', 'sh!t', 'shyt', 'sh1t', 's**t', '$hit', 'shiz',
  'bitch', 'b*tch', 'b!tch', 'b1tch', 'biatch', 'bytch', 'b*ch',
  'ass', 'a$$', 'a**', '@ss', 'a$s', 'azz', 'a55', 'a*s',
  'cock', 'c0ck', 'cok', 'c*ck', 'c**k', 'c0k', 'cawk',
  'dick', 'd*ck', 'd1ck', 'd!ck', 'dic', 'dik', 'd**k', 'd1k',
  'pussy', 'p*ssy', 'pu$$y', 'pus*y', 'pu**y', 'pussi', 'p**sy', 'p0ssy',
  'cunt', 'c*nt', 'cvnt', 'c**t', 'kunt', 'kant',
  'whore', 'wh*re', 'w**re', 'h0e', 'hoe', 'ho',
  'slut', 'sl*t', '$lut', 's1ut', 'sl00t',
  'bastard', 'b@stard', 'bast*rd', 'b**tard',
  'damn', 'd*mn', 'dman', 'damm', 'dam',
  'piss', 'p*ss', 'p1ss', 'pi$$', 'pis',
  'crap', 'cr@p', 'cr*p', 'crxp',
  'prick', 'pr*ck', 'prik', 'pr1ck',
  'poon', 'p00n', 'p*on',
  'wank', 'w@nk', 'w*nk', 'w4nk',
  'cum', 'c*m', 'cvm', 'coom',
  'jizz', 'j*zz', 'jiz', 'j1zz',
  'fag', 'f@g', 'f*g', 'fagg', 'f4g',
  'anal', '@nal', 'an@l', 'an*l',
  'blowjob', 'blow*', 'bj',
  'handjob', 'handj*', 'hj',
  'jerking', 'jerk*',
  'jackoff', 'jack*',
  'rimjob', 'rimj*',

  // Racial/identity slurs (general patterns without listing actual slurs)
  'n*gg', 'n1gg', 'nigg', 'nig',
  'ch*nk', 'chink',
  'sp*c', 'sp1c',
  'k*ke', 'k1ke',
  'f*ggot', 'faggot', 'fagot', 'f4ggot',
  'tr*nny', 'tr4nny',
  'r*tard', 'ret*rd', 'retard',

  // Violent/disturbing content
  'rape', 'r@pe', 'r*pe', 'r4pe',
  'kill', 'k*ll', 'k1ll',
  'murder', 'murd*r',
  'suicide', 'su*cide', 'suic*de',

  // Phrases or combined words
  'gtfo', 'stfu', 'wtf', 'f you', 'fu ', 'af ', 'fck you', 'fcku',
  'go die', 'kys', 'kms',

  // Commonly filtered words in games
  'hitler', 'nazi', 'terrorist',
  'molest', 'pedophile', 'pedo'
];

/**
 * Advanced inappropriate content detection
 * Checks text against a comprehensive list of inappropriate words and patterns
 */
function containsInappropriateContent(text) {
  if (!text || typeof text !== 'string') return false; // Basic validation
  // Convert to lowercase for case-insensitive matching
  const lowerText = text.toLowerCase();

  // Remove spaces for detecting words that might be s p a c e d out
  const noSpaceText = lowerText.replace(/\s+/g, '');

  // First check the spaced out text
  for (const word of INAPPROPRIATE_WORDS) {
    // Only check words long enough to be meaningful in spaced-out form
    if (word.length >= 3 && noSpaceText.includes(word)) {
      console.log(`Inappropriate content (spaced): "${word}" in "${text}"`);
      return true;
    }
  }

  // Check for words with word boundaries (more precise matching)
  for (const word of INAPPROPRIATE_WORDS) {
    if (word.length >= 3) {
      // Create a regex that matches word boundaries or the word at start/end of text
      // Escape special regex characters in the word itself
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\W)${escapedWord}(\\W|$)`, 'i');
      if (regex.test(lowerText)) {
        console.log(`Inappropriate content (boundary): "${word}" in "${text}"`);
        return true;
      }
    }
  }

  // Check for "leetspeak" style replacements (e.g., numbers for letters)
  // These patterns are simplified examples and might need refinement
  const leetRegexPatterns = [
    /[f]+[^a-z0-9\s]*[u]+[^a-z0-9\s]*[c]+[^a-z0-9\s]*[k]+/i,   // Variations of "fuck"
    /[s]+[^a-z0-9\s]*[h]+[^a-z0-9\s]*[i]+[^a-z0-9\s]*[t]+/i,   // Variations of "shit"
    /[b]+[^a-z0-9\s]*[i]+[^a-z0-9\s]*[t]+[^a-z0-9\s]*[c]+[^a-z0-9\s]*[h]+/i,  // Variations of "bitch"
    /[a]+[^a-z0-9\s]*[s]+[^a-z0-9\s]*[s]+/i,   // Variations of "ass"
    /[n]+[^a-z0-9\s]*[i]+[^a-z0-9\s]*[g]+[^a-z0-9\s]*[g]+/i,   // Variations of racial slurs (example)
    // Add more patterns as needed
  ];

  for (const pattern of leetRegexPatterns) {
    if (pattern.test(lowerText)) {
       console.log(`Inappropriate content (leet): Pattern ${pattern} matched in "${text}"`);
      return true;
    }
  }

  return false;
}

/**
 * Moderates a player message, checking for language and inappropriate content
 * @param {string} message - The message to moderate
 * @param {object} socket - The player's socket to send error messages (can be null for AI)
 * @returns {boolean} - True if message passes moderation, false otherwise
 */
function moderateMessage(message, socket) {
  // Skip moderation for empty or non-string messages
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    // This case should ideally be caught by length validation first, but good to have a check
    return false;
  }

  // 1. Check if message is likely in English
  if (!isLikelyEnglish(message)) {
    console.log(`Non-English message detected: "${message}"`);
    if (socket) { // Only emit if a socket is provided (human player)
        socket.emit('validation_error', "Sorry, only English is supported yet!"); // Use specific event
    }
    return false;
  }

  // 2. Check for inappropriate content
  if (containsInappropriateContent(message)) {
    console.log(`Inappropriate content detected in message: "${message}"`);
    if (socket) { // Only emit if a socket is provided (human player)
        socket.emit('validation_error', "Please, respect other players and AI"); // Use specific event
    }
    return false;
  }

  // Passed all checks
  return true;
}

// --- >>> END Message Moderation <<< ---


// --- >>> NEW: Add timeout constants <<< ---
const FIRST_ATTEMPT_TIMEOUT = 15000; // 15 seconds for the first try
const RETRY_TIMEOUT = 10000; // 10 seconds for the retry

// --- Game Session Class ---
class GameSession {
    // --- >>> MOVED Retry Constants Inside Class <<< ---
    MAX_AI_ATTEMPTS = 3;
    ORIGINAL_AI_ATTEMPT_TIMEOUT = 8000; // Original 8-second timeout
    AI_ATTEMPT_TIMEOUT = this.ORIGINAL_AI_ATTEMPT_TIMEOUT; // Current timeout (can be adjusted)
    // --- >>> END MOVE <<< ---

    constructor(gameId, humanSockets, isSolo = false) {
        this.id = gameId;
        this.roomName = `game-${gameId}`;
        this.players = [];
        this.humanSockets = Array.isArray(humanSockets) ? humanSockets : [humanSockets]; // Ensure it's an array
        this.aiPlayers = [];
        this.currentRound = 0;
        this.currentPhase = null;
        this.currentAskerId = null;
        this.currentQuestion = null;
        this.answers = new Map();
        this.votes = new Map();
        this.activeTimers = { phaseTimeout: null };
        this.phaseAcknowledgments = new Set();
        this.isSoloMode = isSolo; // Set solo mode flag
        this.targetRounds = isSolo ? SOLO_TARGET_ROUNDS : Infinity; // Set target rounds for solo

        // --- Add timeout constants with original values (Done above class properties now)

        // Add tracking for phase acknowledgments timing
        this.phaseAckTimers = new Map();
        // Add tracking for last acknowledgment time per player
        this.lastAckTimes = new Map();
        this.lastPhaseChangeTime = Date.now();
        
        // Add a safety timeout for AI question generation
        this.aiQuestionTimeout = null;

        console.log(`Creating GameSession ${this.id} (Solo: ${this.isSoloMode})`);
        this.initializePlayers();
    }

    // Add a method to reset the AI attempt timeout to its original value
    // This should be called at the beginning of each phase to ensure we start fresh
    resetAIAttemptTimeout() {
        this.AI_ATTEMPT_TIMEOUT = this.ORIGINAL_AI_ATTEMPT_TIMEOUT;
        console.log(`Game ${this.id}: Reset AI attempt timeout to ${this.AI_ATTEMPT_TIMEOUT}ms`);
    }

    initializePlayers() {
        usedNames.clear();
        const humanPlayerData = this.humanSockets.map(socket => ({ // Already handles single or multiple sockets
            id: socket.id,
            socket,
            isHuman: true,
            name: generateUniqueName(),
            avatarEmoji: generateEmojiAvatar(),
            status: 'active'
        }));

        const aiCount = this.isSoloMode ? SOLO_AI_PLAYER_COUNT : DEFAULT_AI_PLAYER_COUNT;
        const aiPlayerData = [];
        for (let i = 0; i < aiCount; i++) {
            aiPlayerData.push({
                id: generateSocketLikeId(), // Use the new function for AI IDs
                socket: null,
                isHuman: false,
                name: generateUniqueName(),
                avatarEmoji: generateEmojiAvatar(),
                status: 'active',
                // --- Add personality index ---
                promptPersonalityIndex: Math.floor(Math.random() * 3) // 0, 1, or 2
            });
        }
        this.aiPlayers = aiPlayerData;
        let allPlayers = [...humanPlayerData, ...aiPlayerData];
        shuffleArray(allPlayers);
        this.players = allPlayers;
    }
    getPublicPlayerData() {
        return this.players.map(p => ({
            id: p.id,
            name: p.name,
            avatarEmoji: p.avatarEmoji,
            status: p.status
            // DO NOT SEND isHuman or isSoloMode here - client derives solo from game_start
        }));
    }

    // --- Game Loop Logic ---
    startGameLoop() { this.startNextRound(); }
    startNextRound() {
        // Check game end *before* incrementing round, especially for solo mode target rounds
        if (this.checkGameEnd()) return;

        // For solo mode, check if the *next* round would exceed the target *after* this round completes
        // This check is now primarily handled within checkGameEnd after the reveal phase

        this.currentRound++;
        this.currentAskerId = null;
        this.currentQuestion = null;
        this.answers.clear();
        this.votes.clear();
        this.players.forEach(p => p.hasVoted = false);
        console.log(`\n--- Game ${this.id}: Starting Round ${this.currentRound} (Solo: ${this.isSoloMode}, Target: ${this.targetRounds}) ---`);
        this.startPhase('ASKING');
    }

    // --- >>> NEW: Add AI Action Retry Helper <<< ---
    // Replace the attemptAIActionWithRetry method in GameSession class
    async attemptAIActionWithRetry(player, actionType, context) {
        const actionFuncMap = {
            question: aiController.getAIQuestion,
            answer: aiController.getAIAnswer,
            vote: aiController.getAIVote
        };
        const fallbackValueMap = {
            question: this.getRandomFallbackQuestion(),
            answer: "(AI Error/Timeout)",
            vote: null  // Abstain on vote error
        };

        const actionFunc = actionFuncMap[actionType];
        const fallback = fallbackValueMap[actionType];
        const playerName = player.name || player.id;

        // We skip the delay for question type since that's handled separately in generateAIQuestionWithTimeout
        if (actionType !== 'question') {
            // Calculate a random delay between 8-15 seconds
            const minDelay = 8000;  // 8 seconds
            const maxDelay = 15000; // 15 seconds
            const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;

            console.log(`Game ${this.id}: AI ${playerName} waiting ${randomDelay/1000}s before ${actionType}`);

            // Wait for the random delay
            await new Promise(resolve => setTimeout(resolve, randomDelay));

            // Adjust timeout for the remaining time
            // Note: The original logic `8000 - (randomDelay - 8000)` seems complex.
            // A simpler approach might be `15000 - randomDelay` to use the total time budget.
            // Let's stick to the provided logic for now, but it might need review.
            // It seems to intend to reduce the timeout if the delay was long, ensuring a total time around 16s?
            // Let's use the provided logic: timeout = max(5000, 8000 - (delay - 8000))
            // If delay = 8000, timeout = 8000
            // If delay = 15000, timeout = max(5000, 8000 - 7000) = 5000
            this.AI_ATTEMPT_TIMEOUT = Math.max(5000, this.ORIGINAL_AI_ATTEMPT_TIMEOUT - (randomDelay - this.ORIGINAL_AI_ATTEMPT_TIMEOUT));
            console.log(`Game ${this.id}: Adjusted timeout for ${actionType} to ${this.AI_ATTEMPT_TIMEOUT}ms based on delay ${randomDelay}ms`);
        }

        // Add prompt template selection
        let promptTemplate = null;
        if (actionType === 'question') {
            promptTemplate = this.getPromptTemplateForPlayer(player);
        } else if (actionType === 'answer') {
            promptTemplate = ANSWER_PROMPTS[player.promptPersonalityIndex] || ANSWER_PROMPTS[0];
        }

        console.log(`Game ${this.id}: Starting ${actionType} for AI ${playerName} with ${this.MAX_AI_ATTEMPTS} attempts and ${this.AI_ATTEMPT_TIMEOUT}ms timeout`);

        for (let attempt = 1; attempt <= this.MAX_AI_ATTEMPTS; attempt++) {
            console.log(`Game ${this.id}: AI ${playerName} attempting ${actionType} (Attempt ${attempt}/${this.MAX_AI_ATTEMPTS})`);

            try {
                // Create a timeout promise
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Timeout')), this.AI_ATTEMPT_TIMEOUT);
                });

                // Create the action promise
                const actionPromise = actionFunc(
                    player,
                    actionType === 'question' ? promptTemplate : context?.question,
                    actionType === 'answer' ? promptTemplate : context?.answersData // Pass answersData for vote context if needed by AI
                );

                // Race the promises
                const result = await Promise.race([actionPromise, timeoutPromise]);

                // Validate Result with detailed logging
                let isValid = false;
                if (actionType === 'vote') {
                    // Allow explicit null votes (abstaining) or valid string IDs
                    isValid = (result === null) ||
                             (typeof result === 'string' &&
                              result.length > 0 &&
                              !result.toLowerCase().includes("error") &&
                              !result.toLowerCase().includes("blocked") &&
                              !result.toLowerCase().includes("timeout"));
                } else {
                    // Question or Answer validation
                    isValid = typeof result === 'string' &&
                             result.length >= 2 &&
                             !result.toLowerCase().includes("error") &&
                             !result.toLowerCase().includes("blocked") &&
                             !result.toLowerCase().includes("timeout");
                }

                if (isValid) {
                    console.log(`Game ${this.id}: AI ${playerName} ${actionType} success (Attempt ${attempt}): "${result ? result.substring(0, 50) : result}${result && result.length > 50 ? '...' : ''}"`);
                    return result;
                }

                console.warn(`Game ${this.id}: AI ${playerName} ${actionType} returned invalid result (Attempt ${attempt}): ${result ? JSON.stringify(result) : 'null/undefined'}`);
                if (attempt === this.MAX_AI_ATTEMPTS) {
                    console.error(`Game ${this.id}: AI ${playerName} ${actionType} failed after ${this.MAX_AI_ATTEMPTS} attempts. Using fallback: "${fallback}"`);
                    return fallback;
                }

            } catch (error) {
                const errorMsg = error.message === 'Timeout' ? 'timed out' : 'encountered an error';
                console.warn(`Game ${this.id}: AI ${playerName} ${actionType} ${errorMsg} (Attempt ${attempt}): ${error.message}`);

                if (attempt === this.MAX_AI_ATTEMPTS) {
                    console.error(`Game ${this.id}: AI ${playerName} ${actionType} failed after ${this.MAX_AI_ATTEMPTS} attempts. Using fallback: "${fallback}"`);
                    return fallback;
                }
            }

            // Add a short delay between attempts
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Failsafe
        console.error(`Game ${this.id}: AI ${playerName} ${actionType} loop finished unexpectedly. Using fallback: "${fallback}"`);
        return fallback;
    }

    // Modify handlePhaseAcknowledgment to detect slow acknowledgments
    handlePhaseAcknowledgment(socketId) {
        if (!socketId || this.currentPhase === null) return;
        
        const now = Date.now();
        this.phaseAcknowledgments.add(socketId);
        this.lastAckTimes.set(socketId, now); // Update last ack time
        
        const acknowledgmentTime = now - this.lastPhaseChangeTime;
        console.log(`Game ${this.id}: Client ${socketId} acknowledged phase ${this.currentPhase} (${acknowledgmentTime}ms)`);
        
        // If acknowledgment took more than 1.5 seconds, it might indicate a UI issue (Keep this logic?)
        // Let's keep the slow ack check for now, it might still be useful
        if (acknowledgmentTime > 1500) {
            console.log(`Game ${this.id}: Slow acknowledgment from ${socketId} (${acknowledgmentTime}ms) - sending refresh`);
            const socket = this.players.find(p => p.id === socketId)?.socket;
            if (socket) {
                socket.emit('force_refresh_ui');
            }
        }
        
        // Check if all human players acknowledged
        const humanPlayerIds = this.players
            .filter(p => p.isHuman && p.status === 'active')
            .map(p => p.id);
            
        const allAcknowledged = humanPlayerIds.every(id => this.phaseAcknowledgments.has(id));
        
        if (allAcknowledged) {
            console.log(`Game ${this.id}: All human players acknowledged phase ${this.currentPhase}`);
            // Could implement additional synchronization logic here if needed
        }
    }

    // Modify startPhase to track timing
    async startPhase(phaseName) {
        // Reset AI attempt timeout to original value
        this.resetAIAttemptTimeout();

        // Clear any existing AI question timeout
        if (this.aiQuestionTimeout) {
            clearTimeout(this.aiQuestionTimeout);
            this.aiQuestionTimeout = null;
        }

        // Clear previous acknowledgments when starting a new phase
        this.phaseAcknowledgments.clear();

        // Store the time of this phase change
        this.lastPhaseChangeTime = Date.now();
        
        // Clear any pending ack timers
        this.phaseAckTimers.forEach(timer => clearTimeout(timer));
        this.phaseAckTimers.clear();
        
        // Set timers for each human player to detect missing acks
        const humanPlayers = this.players.filter(p => p.isHuman && p.status === 'active');
        humanPlayers.forEach(player => {
            const timer = setTimeout(() => {
                if (!this.phaseAcknowledgments.has(player.id)) {
                    console.log(`Game ${this.id}: No ack from ${player.name} after 3000ms - sending refresh`);
                    if (player.socket) {
                        player.socket.emit('force_refresh_ui');
                    }
                }
            }, 3000);
            
            this.phaseAckTimers.set(player.id, timer);
        });
        
        // Continue with existing startPhase code...
        this.currentPhase = phaseName;
        const duration = ROUND_PHASE_DURATION[phaseName];
        console.log(`Game ${this.id}: Phase: ${phaseName} (${duration}s)`);
        
        if (this.activeTimers.phaseTimeout) {
            clearTimeout(this.activeTimers.phaseTimeout);
            this.activeTimers.phaseTimeout = null;
        }

        let phaseData = { round: this.currentRound, phase: phaseName, duration: duration };

        try {
            if (phaseName === 'ASKING') {
                const active = this.players.filter(p => p.status === 'active');
                if (active.length < 2) {
                    this.endGame("Not enough players");
                    return;
                }

                this.currentAskerId = active[~~(Math.random() * active.length)].id;
                const asker = this.players.find(p => p.id === this.currentAskerId);
                phaseData.askerId = this.currentAskerId;
                phaseData.askerName = asker?.name || '?';

                if (!asker.isHuman) {
                    // For AI asker, we'll emit the phase first, then get the question
                    console.log(`Game ${this.id}: AI ${asker.name} is asking a question`);
                    
                    // Emit phase data first
                    io.to(this.roomName).emit('new_round_phase', phaseData);
                    console.log(`Game ${this.id}: Emitted ASKING Phase (AI Asker)`);
                    
                    // DIRECT APPROACH: Generate the question right here, no complex callbacks
                    this.generateAIQuestionWithTimeout(asker);
                    
                    return; // Exit early - the question generation function will handle the next phase
                } else {
                    // Human asker - set normal timeout
                    this.activeTimers.phaseTimeout = setTimeout(() => this.handleAskTimeout(), duration * 1000);
                }

            } else if (phaseName === 'ANSWERING') {
                if (!this.currentQuestion) this.currentQuestion = "Default Q";
                phaseData.question = this.currentQuestion;
                phaseData.askerId = this.currentAskerId;
                phaseData.askerName = this.players.find(p => p.id === this.currentAskerId)?.name || '?';

                // Start AI answer processing after emission
                const aiAnswerPromises = this.players
                    .filter(p => p.status === 'active' && !p.isHuman && p.id !== this.currentAskerId)
                    .map(p => this.attemptAIActionWithRetry(p, 'answer', { question: this.currentQuestion })
                        .then(answer => this.handlePlayerAnswer(p.id, answer))
                        .catch(e => {
                            console.error(`Game ${this.id}: AI answer error for ${p.name}:`, e);
                            this.handlePlayerAnswer(p.id, "(AI Error)");
                        }));

                this.activeTimers.phaseTimeout = setTimeout(() => this.handleAnswerTimeout(), duration * 1000);

            } else if (phaseName === 'VOTING') {
                const answersPayload = {};
                this.answers.forEach((ans, pid) => {
                    const p = this.players.find(pl => pl.id === pid);
                    answersPayload[pid] = { name: p?.name || '?', answer: ans };
                });
                phaseData.answers = answersPayload;
                phaseData.question = this.currentQuestion;

                // Start AI vote processing after emission
                const aiVotePromises = this.players
                    .filter(p => p.status === 'active' && !p.isHuman)
                    .map(p => this.attemptAIActionWithRetry(p, 'vote', { answersData: answersPayload })
                        .then(votedId => this.handlePlayerVote(p.id, votedId))
                        .catch(e => {
                            console.error(`Game ${this.id}: AI vote error for ${p.name}:`, e);
                            this.handlePlayerVote(p.id, null);
                        }));

                this.activeTimers.phaseTimeout = setTimeout(() => this.handleVoteTimeout(), duration * 1000);

            } else if (phaseName === 'REVEAL') {
                const results = this.calculateResults();
                
                // Add eliminated player roles to results
                const eliminatedDetails = results.eliminatedIds.map(id => {
                    const player = this.players.find(p => p.id === id);
                    return {
                        id: id,
                        name: player?.name || '?',
                        isHuman: player?.isHuman ?? null
                    };
                });

                phaseData.results = {
                    voteCounts: results.voteCounts,
                    eliminatedDetails: eliminatedDetails,
                    votes: Object.fromEntries(this.votes)
                };
                console.log(`Game ${this.id}: Reveal Results - Eliminated: ${eliminatedDetails.map(e=>e.name).join(', ') || 'Nobody'}`);
                results.eliminatedIds.forEach(id => { const p = this.players.find(pl => pl.id === id); if (p) p.status = 'eliminated'; });
                phaseData.players = this.getPublicPlayerData();
                this.activeTimers.phaseTimeout = setTimeout(() => { if (!this.checkGameEnd()) { this.startNextRound(); } }, duration * 1000);
            }

            // Emit phase data for all cases except AI asking
            io.to(this.roomName).emit('new_round_phase', phaseData);
            console.log(`Game ${this.id}: Emitted Phase: ${phaseName}`);

        } catch (error) {
            console.error(`Game ${this.id}: Error during startPhase ${phaseName}:`, error);
            this.endGame(`Critical error during ${phaseName}`);
        }
    }
    
    // Add method to check UI state of all players
    checkUISync() {
        console.log(`Game ${this.id}: Checking UI sync for all players`);
        
        // Only check if we're not in the middle of a phase transition
        const currentTime = Date.now();
        const timeSinceLastPhaseChange = currentTime - this.lastPhaseChangeTime;
        
        // Skip if we just changed phases in the last 3 seconds
        if (timeSinceLastPhaseChange < 3000) {
            console.log(`Game ${this.id}: Skipping UI sync check (recent phase change)`);
            return;
        }
        
        // Send a periodic UI check only to players who haven't acknowledged recently
        this.players
            .filter(p => p.isHuman && p.status === 'active' && p.socket)
            .forEach(player => {
                // Only check players who haven't acknowledged in the last 10 seconds
                // Use lastAckTimes map here
                const lastAckTime = this.lastAckTimes.get(player.id) || 0; // Default to 0 if no ack yet
                const timeSinceLastAck = currentTime - lastAckTime;
                    
                if (timeSinceLastAck > 10000) {
                    console.log(`Game ${this.id}: Checking UI sync for ${player.name} (${timeSinceLastAck}ms since last ack)`);
                    
                    player.socket.emit('check_ui_state', {
                        currentPhase: this.currentPhase,
                        round: this.currentRound,
                        timestamp: currentTime
                    });
                }
            });
    }

    // calculateResults (keep as before)
    calculateResults() { /* ... */ const vC={}; const act=this.players.filter(p=>p.status==='active'); act.forEach(p=>{vC[p.id]=0;}); this.votes.forEach((vId,voterId)=>{const vr=this.players.find(p=>p.id===voterId);if(vId!==null&&vC.hasOwnProperty(vId)&&vr?.status==='active'){vC[vId]++;}}); console.log(`Vote counts:`,vC); let maxV=0; for(const pId in vC){if(vC[pId]>maxV)maxV=vC[pId];} const elimIds=[],elimN=[];if(maxV>0){for(const pId in vC){if(vC[pId]===maxV){elimIds.push(pId);const p=this.players.find(pl=>pl.id===pId);if(p)elimN.push(p.name);}}} return{voteCounts:vC,eliminatedIds:elimIds,eliminatedNames:elimN}; }
    // Modified checkGameEnd for Solo Mode
    checkGameEnd() {
        const activeHumans = this.players.filter(p => p.status === 'active' && p.isHuman);
        const activeAI = this.players.filter(p => p.status === 'active' && !p.isHuman);
        const activeHumanCount = activeHumans.length;
        const activeAICount = activeAI.length;

        console.log(`Game ${this.id} End Check - Round: ${this.currentRound}, Solo: ${this.isSoloMode}, H:${activeHumanCount}, A:${activeAICount}`);

        if (this.isSoloMode) {
            // Solo Mode Logic:
            // 1. Human eliminated?
            if (activeHumanCount === 0) {
                this.endGame({
                    reason: "AI wins! You were eliminated.",
                    winner: "ai", // Technically AI wins
                    soloOutcome: "eliminated" // Specific outcome for client UI
                });
                return true;
            }
            // 2. Survived target rounds? (Check *after* the target round is completed)
            if (this.currentRound >= this.targetRounds) {
                 // Check if the human is still active *after* the final round's reveal
                 const humanPlayer = activeHumans[0]; // Should only be one
                 if (humanPlayer && humanPlayer.status === 'active') {
                    this.endGame({
                        reason: `You survived ${this.targetRounds} rounds!`,
                        winner: "humans", // Human wins solo mode
                        soloOutcome: "survived" // Specific outcome for client UI
                    });
                    return true;
                 }
                 // If human was eliminated in the *final* round's reveal, the first condition (activeHumanCount === 0) will catch it.
            }
            // 3. Game continues if neither condition met
            return false;

        } else {
            // Original Multiplayer Logic:
            if (activeAICount === 0) {
                this.endGame({
                    reason: "Humans win!",
                    winner: "humans"
                });
                return true;
            }
            if (activeHumanCount === 0) {
                this.endGame({
                    reason: "AI wins!",
                    winner: "ai"
                });
                return true;
            }
            return false;
        }
    }


    // Action Handlers (keep as before)
    handlePlayerQuestion(playerId, questionText) {
        // Get existing checks
        if (this.currentPhase !== 'ASKING' || playerId !== this.currentAskerId) return;

        // Find the player and socket
        const player = this.players.find(p => p.id === playerId);
        if (!player || !player.socket) return; // Should not happen for human asker

        // Length validation (keep existing validation)
        if (typeof questionText !== 'string' ||
            questionText.length === 0 ||
            questionText.length > QUESTION_MAX_LENGTH) {
            player.socket.emit('action_error', { message: `Question must be between 1-${QUESTION_MAX_LENGTH} characters` });
            return;
        }

        // --- >>> Add moderation check <<< ---
        if (!moderateMessage(questionText, player.socket)) {
            return; // Early return if moderation fails
        }
        // --- >>> END moderation check <<< ---

        // If we get here, message passed moderation
        this.currentQuestion = questionText.trim();
        console.log(`Game ${this.id}: Question accepted from ${player.name}: "${this.currentQuestion}"`);

        // Continue with phase change
        if (this.activeTimers.phaseTimeout) clearTimeout(this.activeTimers.phaseTimeout);
        this.startPhase('ANSWERING');
    }
    handleAskTimeout() {
        if (this.currentPhase === 'ASKING') {
            console.log(`Game ${this.id}: Asker ${this.currentAskerId} timed out.`);
            
            // Use a better fallback question
            const fallbackQuestions = [
                "What's your favorite color?",
                "Dogs or cats?",
                "Favorite food?",
                "Best vacation spot?",
                "Morning or night person?",
                "Favorite movie?",
                "Dream job?",
                "Ideal superpower?"
            ];
            const fallbackQuestion = fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
            console.log(`Game ${this.id}: Using fallback question after timeout: "${fallbackQuestion}"`);
            
            this.currentQuestion = fallbackQuestion;
            this.startPhase('ANSWERING');
        }
    }
    handlePlayerAnswer(playerId, answerText) {
        const player = this.players.find(pl => pl.id === playerId);

        // Existing checks
        if (this.currentPhase !== 'ANSWERING' || !player || player.status !== 'active' || playerId === this.currentAskerId || this.answers.has(playerId)) {
            return;
        }

        // Length validation
        if (typeof answerText !== 'string' || answerText.length === 0 || answerText.length > ANSWER_MAX_LENGTH) {
            // Only send error to human players
            if (player.socket) {
                player.socket.emit('action_error', { message: `Answer must be between 1-${ANSWER_MAX_LENGTH} characters` });
            }
            // For AI, we might log this or handle it differently, but for now, just return
            console.warn(`Game ${this.id}: Invalid answer length from ${player.name} (ID: ${playerId}). Length: ${answerText?.length}`);
            return;
        }

        // --- >>> Add moderation check <<< ---
        // Pass player.socket only if it's a human player
        if (!moderateMessage(answerText, player.isHuman ? player.socket : null)) {
            // If moderation fails for an AI, set a generic placeholder instead of returning
            if (!player.isHuman) {
                console.log(`Game ${this.id}: AI ${player.name}'s answer failed moderation. Setting placeholder.`);
                this.answers.set(playerId, "(Answer Blocked)");
                this.checkIfPhaseComplete(); // Still check completion
            }
            // For humans, the error is emitted inside moderateMessage, so just return
            return;
        }
        // --- >>> END moderation check <<< ---

        // If we get here, message passed moderation
        this.answers.set(playerId, answerText.trim());
        console.log(`Game ${this.id}: Answer accepted from ${player.name}. Total answers: ${this.answers.size}`);
        this.checkIfPhaseComplete();
    }
    handleAnswerTimeout() {
        if (this.currentPhase === 'ANSWERING') {
            console.log(`Game ${this.id}: Answer phase timed out.`);
            const activePlayers = this.players.filter(p => p.status === 'active');
            activePlayers.forEach(p => {
                if (p.id !== this.currentAskerId && !this.answers.has(p.id)) {
                    console.log(`Game ${this.id}: ${p.name} did not submit an answer.`);
                    this.answers.set(p.id, "(No answer)");
                }
            });
            this.startPhase('VOTING');
        }
    }
    handlePlayerVote(voterId, votedId) {
        console.log(`Game ${this.id}: Received vote attempt from ${voterId} for ${votedId}`);
        const voter = this.players.find(p => p.id === voterId);

        // --- Validation ---
        // 1. Check if Voting Phase
        if (this.currentPhase !== 'VOTING') { console.warn(`Vote received outside VOTING phase from ${voterId}. Ignored.`); return; }
        // 2. Check if Voter is Active
        if (!voter || voter.status !== 'active') { console.warn(`Vote received from inactive/unknown voter ${voterId}. Ignored.`); return; }
        // 3. Check if Voter Already Voted
        if (voter.hasVoted) { console.warn(`Voter ${voterId} already voted. Ignored.`); return; }

        // Handle Abstain (null votedId)
        if (votedId === null) {
            console.log(`Game ${this.id}: Voter ${voter.name} abstained.`);
            this.votes.set(voterId, null);
            voter.hasVoted = true;
        } else {
            // 4. Check if Target Player Exists and is Active
            const votedPlayer = this.players.find(p => p.id === votedId);
            if (!votedPlayer || votedPlayer.status !== 'active') {
                console.warn(`Vote target ${votedId} is inactive or invalid. Voter ${voter.name} abstains.`);
                this.votes.set(voterId, null);
                voter.hasVoted = true;
                if (voter.socket) { voter.socket.emit('action_error', { message: `Cannot vote for ${votedPlayer?.name || 'that player'}. Vote counts as abstain.` }); }
            // 5. Check for Self-Vote
            } else if (voterId === votedId) {
                console.warn(`Player ${voter.name} attempted to vote for self. Vote ignored (counts as abstain).`);
                this.votes.set(voterId, null);
                voter.hasVoted = true;
                if (voter.socket) { voter.socket.emit('action_error', { message: `You cannot vote for yourself. Vote counts as abstain.` }); }
            } else {
                // Valid vote
                this.votes.set(voterId, votedId);
                voter.hasVoted = true;
                console.log(`Vote Acc: ${voter.name} -> ${votedPlayer.name}`);
            }
        }

        if (voter.socket) { voter.socket.emit('vote_accepted'); }
        this.checkIfPhaseComplete();
    }
    handleVoteTimeout() { /* ... */ if(this.currentPhase==='VOTING'){console.log(`Vote timeout.`);this.players.forEach(p=>{if(p.status==='active'&&!p.hasVoted){console.log(`${p.name} no vote.`);this.votes.set(p.id,null);p.hasVoted=true;}});this.startPhase('REVEAL');}}
    handleDisconnect(playerId) { /* ... */ const p=this.players.find(pl=>pl.id===playerId);if(p&&p.status==='active'){p.status='disconnected';console.log(`${p.name} disconnected.`);if(this.currentPhase==='ASKING'&&this.currentAskerId===playerId){if(this.activeTimers.phaseTimeout)clearTimeout(this.activeTimers.phaseTimeout);this.handleAskTimeout();}else if(this.currentPhase==='ANSWERING'&&playerId!==this.currentAskerId){this.answers.set(playerId,"(Disconnected)");this.checkIfPhaseComplete();}else if(this.currentPhase==='VOTING'){if(!p.hasVoted){this.votes.set(playerId,null);p.hasVoted=true;this.checkIfPhaseComplete();}}io.to(this.roomName).emit('player_update',{players:this.getPublicPlayerData()});this.checkGameEnd();}}
    checkIfPhaseComplete() { /* ... */ const act=this.players.filter(p=>p.status==='active');if(this.currentPhase==='ANSWERING'){const exp=act.filter(p=>p.id!==this.currentAskerId).length; const cur=Array.from(this.answers.keys()).filter(id=>act.some(p=>p.id===id)).length;if(cur>=exp&&exp>0){console.log("Ans phase complete early.");if(this.activeTimers.phaseTimeout)clearTimeout(this.activeTimers.phaseTimeout);this.startPhase('VOTING');}}else if(this.currentPhase==='VOTING'){const exp=act.length;const cur=act.filter(p=>p.hasVoted).length;if(cur>=exp&&exp>0){console.log("Vote phase complete early.");if(this.activeTimers.phaseTimeout)clearTimeout(this.activeTimers.phaseTimeout);this.startPhase('REVEAL');}}}
    endGame(gameEndData) {
        // If string was passed, convert to object for backward compatibility
        const endData = typeof gameEndData === 'string' 
            ? { reason: gameEndData } 
            : gameEndData || { reason: "Game ended" };

        console.log(`Game ${this.id}: End! ${endData.reason}`);

        // Add timestamp and final player state
        endData.timestamp = Date.now();
        endData.finalState = {
            players: this.getPublicPlayerData(),
            round: this.currentRound
        };

        // Add soloOutcome if it's part of the endData (set in checkGameEnd for solo)
        if (endData.soloOutcome) {
            // No need to add it again, it's already in endData
        }

        io.to(this.roomName).emit('game_over', endData); // Send the potentially modified endData

        this.clearAllTimers();
        activeGames.delete(this.id);
        
        this.humanSockets.forEach(s => {
            s.leave(this.roomName);
            delete s.gameId;
        });
        
        console.log(`Game ${this.id}: Cleaned.`);
    }
    clearAllTimers() { 
        if(this.activeTimers.phaseTimeout){
            clearTimeout(this.activeTimers.phaseTimeout);
            this.activeTimers.phaseTimeout = null;
        }
        
        if (this.aiQuestionTimeout) {
            clearTimeout(this.aiQuestionTimeout);
            this.aiQuestionTimeout = null;
        }
    }

    // Add this new method to the GameSession class
    async generateAIQuestionWithTimeout(asker) {
        // Calculate a random delay between 8-15 seconds
        const minDelay = 8000;  // 8 seconds
        const maxDelay = 15000; // 15 seconds
        const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;

        console.log(`Game ${this.id}: AI ${asker.name} waiting ${randomDelay/1000}s before asking question`);

        // Wait for the random delay
        await new Promise(resolve => setTimeout(resolve, randomDelay));

        // Adjust the timeout based on the remaining time
        const remainingTimeout = 15000 - randomDelay;
        const timeoutDuration = Math.max(5000, remainingTimeout); // Ensure at least 5 seconds

        // Clear any previous safety timeout just in case
        if (this.aiQuestionTimeout) {
            clearTimeout(this.aiQuestionTimeout);
            this.aiQuestionTimeout = null;
        }

        // Set up a timeout for AI question generation (adjusted for the delay)
        const timeoutPromise = new Promise((resolve) => {
            // Store the timer ID so we can clear it if the question comes back faster
            this.aiQuestionTimeout = setTimeout(() => {
                console.log(`Game ${this.id}: AI question generation timed out after ${timeoutDuration/1000}s (adjusted)`);
                resolve({
                    timedOut: true,
                    question: this.getRandomFallbackQuestion()
                });
                this.aiQuestionTimeout = null; // Clear the reference once it fires
            }, timeoutDuration);
        });

        // Try to get AI question
        const questionPromise = new Promise(async (resolve) => {
            try {
                const promptTemplate = this.getPromptTemplateForPlayer(asker);
                // Use the attemptAIActionWithRetry for consistency, even though timeout is handled outside
                // Pass a very long internal timeout to rely on the outer Promise.race
                const question = await this.attemptAIActionWithRetry(
                    asker,
                    'question',
                    { /* no context needed here */ },
                    // Override timeout for this specific call within the retry logic
                    // Set a large timeout so the outer race condition handles it primarily
                    { overrideTimeout: 60000 } // e.g., 60 seconds, much larger than outer timeout
                );

                // If attemptAIActionWithRetry returns the fallback due to *internal* errors/timeouts
                // it will still resolve here. We check if it's the fallback.
                if (question === this.getRandomFallbackQuestion()) {
                     console.log(`Game ${this.id}: AI question generation resulted in fallback internally.`);
                     resolve({ timedOut: true, question: question }); // Treat internal fallback as timeout for simplicity
                } else {
                    console.log(`Game ${this.id}: AI question generated: "${question}"`);
                    resolve({ timedOut: false, question: question });
                }
            } catch (error) {
                // This catch might be less likely if attemptAIActionWithRetry handles its errors
                console.error(`Game ${this.id}: Error generating AI question (outer promise):`, error);
                resolve({
                    timedOut: true,
                    error: error,
                    question: this.getRandomFallbackQuestion()
                });
            }
        });

        // Race the promises
        const result = await Promise.race([timeoutPromise, questionPromise]);

        // IMPORTANT: Clear the timeout timer if the question promise resolved first
        if (this.aiQuestionTimeout) {
            clearTimeout(this.aiQuestionTimeout);
            this.aiQuestionTimeout = null;
        }

        console.log(`Game ${this.id}: AI question result:`,
            result.timedOut ? "TIMED OUT" : "SUCCESS",
            `"${result.question}"`);

        // Always proceed to the next phase, with either the generated question or fallback
        this.currentQuestion = result.question;
        // Check the phase *again* right before transitioning, as things might change
        if (this.currentPhase === 'ASKING') {
            console.log(`Game ${this.id}: Moving to ANSWERING phase with question: "${result.question}"`);
            // Ensure we don't double-trigger startPhase if it was already called by a timeout
            this.startPhase('ANSWERING');
        } else {
            console.log(`Game ${this.id}: Not in ASKING phase anymore (currently ${this.currentPhase}), question generated but not used for transition.`);
        }
    }


    // Helper method to get a fallback question
    getRandomFallbackQuestion() {
        const fallbackQuestions = [
            "What's your favorite color?",
            "Dogs or cats?",
            "Favorite food?",
            "Best vacation spot?",
            "Morning or night person?",
            "Favorite movie?",
            "Dream job?",
            "Ideal superpower?"
        ];
        return fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
    }

    // Helper to get the right prompt template for a player
    getPromptTemplateForPlayer(player) {
        // Ensure QUESTION_PROMPTS is accessible or passed in if needed
        if (!QUESTION_PROMPTS) {
            console.error("QUESTION_PROMPTS is not defined/accessible in getPromptTemplateForPlayer");
            return null; // Or handle error appropriately
        }
        if (!player.promptPersonalityIndex || player.promptPersonalityIndex < 0) {
            return QUESTION_PROMPTS[0]; // Default to first template
        }
        const index = Math.min(player.promptPersonalityIndex, QUESTION_PROMPTS.length - 1);
        return QUESTION_PROMPTS[index];
    }

} // --- End GameSession Class ---

// Set up periodic UI checks for all active games
function setupPeriodicUISyncChecks() {
    setInterval(() => {
        activeGames.forEach(game => {
            game.checkUISync();
        });
    }, 15000); // Check every 15 seconds
}

// Helpers: broadcastWaitingCount, startGame (keep as before)
function broadcastWaitingCount(){io.emit('waiting_player_count',waitingPlayers.size);}
// Modified startGame to accept isSolo flag
function startGame(playerSockets, isSolo = false){
    const gameId=nextGameId++;
    if(isNaN(gameId)){console.error("FATAL: gameId");return;}
    const session=new GameSession(gameId, playerSockets, isSolo); // Pass isSolo flag
    activeGames.set(gameId,session);
    console.log(`Starting Game ${gameId} (Solo: ${isSolo})`);

    const sockets = Array.isArray(playerSockets) ? playerSockets : [playerSockets]; // Ensure array

    sockets.forEach(s=>{
        s.join(session.roomName);
        s.gameId=gameId;
    });

    // Add isSolo flag to initial data sent to clients
    const initialData={
        gameId:session.id,
        roomName:session.roomName,
        players:session.getPublicPlayerData(),
        isSolo: isSolo, // Add the flag here
        yourPlayerId:null
    };

    if(isNaN(session.id)){console.error("FATAL: session.id");return;}

    sockets.forEach(s=>{
        const personalizedData={...initialData,yourPlayerId:s.id};
        s.emit('game_start',personalizedData);
    });

    session.startGameLoop();
    console.log(`Game ${gameId} loop started.`);
}

// Socket.IO Connection Logic (keep listeners setup)
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`); waitingPlayers.add(socket); broadcastWaitingCount();
    if(waitingPlayers.size>=MAX_PLAYERS_FOR_GAME){ const playersForGame=Array.from(waitingPlayers).slice(0,MAX_PLAYERS_FOR_GAME); playersForGame.forEach(s=>{waitingPlayers.delete(s);}); startGame(playersForGame); broadcastWaitingCount(); }
    // Listeners (Q, Ans, Vote)
    socket.on('submit_question', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const t=typeof data==='string'?data:data?.question; if(typeof t==='string')g.handlePlayerQuestion(socket.id,t);}}});
    socket.on('submit_answer', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const t=typeof data==='string'?data:null; if(t!==null) g.handlePlayerAnswer(socket.id,t);}}});
    socket.on('submit_vote', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const vId=data?.votedId; if(typeof vId==='string'&&vId.length>0)g.handlePlayerVote(socket.id,vId);}}});
    
    // Add new listener for phase acknowledgments
    socket.on('phase_ack', () => {
        if (socket.gameId) {
            const game = activeGames.get(socket.gameId);
            if (game) {
                game.handlePhaseAcknowledgment(socket.id);
            }
        }
    });

    // Add heartbeat handler
    socket.on('heartbeat', () => {
        // Simple echo back to the client
        socket.emit('heartbeat_response');
        // Optional: Could log heartbeat reception if needed for debugging
        // console.log(`Received heartbeat from ${socket.id}`);
    });
    
    // Add UI state checking handler
    socket.on('ui_state_report', (data) => {
        if (socket.gameId) {
            const game = activeGames.get(socket.gameId);
            if (game) {
                // Strict type safety - convert everything to strings for comparison
                const clientPhase = String(data.currentPhase || '').trim();
                const serverPhase = String(game.currentPhase || '').trim();
                
                // More debugging info
                console.log(`Game ${game.id}: Client ${socket.id} state check - ` +
                    `client phase: '${clientPhase}', server phase: '${serverPhase}'`);
                
                // Only send a refresh if the phases are genuinely different
                // Use a strict equality check of the trimmed strings
                if (clientPhase !== serverPhase) {
                    console.log(`Game ${game.id}: Client ${socket.id} has genuinely incorrect phase - sending refresh`);
                    socket.emit('force_refresh_ui', {
                        correctPhase: serverPhase,
                        correctRound: game.currentRound,
                        reason: 'phase_mismatch'
                    });
                } else {
                    // They have the correct phase, so let's not trigger anything
                    console.log(`Game ${game.id}: Client ${socket.id} has correct phase: ${clientPhase}`);
                }
            }
        }
    });

    // Disconnect
    socket.on('disconnect', () => { console.log(`User disconnected: ${socket.id}`); if(waitingPlayers.has(socket)){waitingPlayers.delete(socket);broadcastWaitingCount();}else if(socket.gameId){const g=activeGames.get(socket.gameId);if(g){g.handleDisconnect(socket.id);}}});

    // --- >>> NEW: Solo Game Listener <<< ---
    socket.on('start_solo_game', () => {
        console.log(`Player ${socket.id} requested Solo Survival game.`);
        // Check if player is already in a game
        if (socket.gameId && activeGames.has(socket.gameId)) {
            console.log(`Player ${socket.id} is already in game ${socket.gameId}. Ignoring solo request.`);
            socket.emit('action_error', { message: "You are already in a game." });
            return;
        }
        // Remove from waiting list if present
        if (waitingPlayers.has(socket)) {
            waitingPlayers.delete(socket);
            broadcastWaitingCount(); // Update count for others
        }
        // Start a solo game session
        startGame(socket, true); // Pass the socket and isSolo=true flag
    });
    // --- >>> END Solo Game Listener <<< ---
});

// Add a debug endpoint to check game status
app.get('/api/game-status', (req, res) => {
    const gameStatusInfo = Array.from(activeGames.entries()).map(([id, game]) => ({
        id: id,
        phase: game.currentPhase,
        round: game.currentRound,
        playersCount: game.players.length,
        activePlayersCount: game.players.filter(p => p.status === 'active').length,
        currentAskerId: game.currentAskerId,
        questionText: game.currentQuestion,
        answersCount: game.answers.size,
        timeSincePhaseChange: Date.now() - game.lastPhaseChangeTime
    }));
    
    res.json({
        activeGames: gameStatusInfo,
        waitingPlayers: waitingPlayers.size
    });
});

// Start Server (keep as before)
server.listen(PORT, ()=>{console.log(`Server listening on http://localhost:${PORT}`); console.log('Waiting...');});
server.on('error', (e)=>{console.error('Server error:', e);});

// Call this after server initialization
setupPeriodicUISyncChecks();

console.log("Server script initialized.");
