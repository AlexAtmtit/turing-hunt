// Update the AI action functions in gemini_ai.js to enforce word count
const axios = require('axios');

// --- Configuration ---
const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_NAME = 'liquid/lfm-7b';
const DEFAULT_TIMEOUT = 15000;
const HTTP_REFERER = process.env.OPENROUTER_APP_URL || "http://localhost:3000";

// --- Base Context ---
const BASE_CONTEXT = `You are a player in a social deduction game called Turing Hunt. 3 players are human, 3 are AI (like you). You don't know who is who. Your goal is to help eliminate humans. Humans goal is to eliminate AI. Each round involves asking a question, answering, and voting to eliminate. Avoid revealing you are an AI.`;

// --- Updated Question Prompt Template with STRICT word count ---
const QUESTION_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is %%PLAYER_NAME%%. It is your turn to ask a question.

!!!CRITICAL INSTRUCTION: YOUR RESPONSE MUST BE EXACTLY %%WORD_COUNT%% WORDS, NOT MORE, NOT LESS!!!

Ask a very short, open-ended question designed to subtly probe if other players might be human or AI based on their potential answers. Think about creativity, emotion, or nuanced human experiences. Avoid direct questions about identity or simple calculations.

When generating your question, follow these characteristics and traits:
%%TRAITS_STRING%%

Examples of correct length (%%WORD_COUNT%% words):
- If %%WORD_COUNT%% is 3: "Favorite childhood memory?"
- If %%WORD_COUNT%% is 5: "What makes you feel alive?"
- If %%WORD_COUNT%% is 7: "How do you deal with failure?"

Bad examples:
- Using more than %%WORD_COUNT%% words
- Using less than %%WORD_COUNT%% words
- Answers without appropriate punctuation

COUNT YOUR WORDS CAREFULLY. Your response must be EXACTLY %%WORD_COUNT%% WORDS.
Ask your question now (EXACTLY %%WORD_COUNT%% WORDS):`;

// --- Updated Answer Prompt Template with STRICT word count ---
const ANSWER_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is %%PLAYER_NAME%%. You need to answer the following question.

!!!CRITICAL INSTRUCTION: YOUR RESPONSE MUST BE EXACTLY %%WORD_COUNT%% WORDS, NOT MORE, NOT LESS!!!

The question is: "%%QUESTION_TEXT%%"

Your answer should sound plausible, perhaps slightly quirky or generic, to avoid immediate suspicion.

When answering, follow these characteristics and traits:
%%TRAITS_STRING%%

Examples of correct length (%%WORD_COUNT%% words):
- If %%WORD_COUNT%% is 1: "Maybe."
- If %%WORD_COUNT%% is 3: "I love dogs."
- If %%WORD_COUNT%% is 5: "Coffee makes me feel alive."

Bad examples:
- Using more than %%WORD_COUNT%% words
- Using less than %%WORD_COUNT%% words
- Long, complex sentences

COUNT YOUR WORDS CAREFULLY. Your response must be EXACTLY %%WORD_COUNT%% WORDS.
Provide your answer now (EXACTLY %%WORD_COUNT%% WORDS):`;

// --- Keep the Vote Prompt Template the same ---
const VOTE_PROMPT_TEMPLATE = `
${BASE_CONTEXT}
Your name is %%PLAYER_NAME%%. It's time to vote to eliminate one player.
Analyze the question asked and the answers given by the other players. Try to identify someone who sounds suspiciously human (emotional, creative, specific) or suspiciously AI (generic, logical, nonsensical). Both types are potential targets for elimination from your perspective.

The question asked was: "%%QUESTION_TEXT%%"

Here are the other players and their answers:
%%OTHER_PLAYERS_ANSWERS%%

Based ONLY on the information above, decide which player (by their ID) seems most suspicious.
Respond with ONLY the player ID you want to vote for (e.g., "player-id-123"). Do not add any other text, explanation, or formatting.

Vote for Player ID:`;

// --- AI API call implementation ---
async function callAIAPI(promptText, config = {}) {
    if (!API_KEY) {
         console.warn("OpenRouter API key missing, returning mock response.");
         await new Promise(resolve => setTimeout(resolve, 500));
         return `Mock: ${promptText.substring(0, 50)}...`;
    }

    const requestBody = {
        model: MODEL_NAME,
        messages: [
            { role: "user", content: promptText }
        ],
        ...(config.temperature && { temperature: config.temperature }),
        ...(config.max_tokens && { max_tokens: config.max_tokens }),
    };

    try {
        const response = await axios.post(API_URL, requestBody, {
             headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${API_KEY}`,
                 'HTTP-Referer': HTTP_REFERER,
             },
             timeout: DEFAULT_TIMEOUT
        });

        const text = response.data?.choices?.[0]?.message?.content;
        if (text) {
            console.log(`OpenRouter Response (start): "${text.substring(0, 100)}..."`);
            return text.trim();
        } else {
            console.error("Error: Could not extract text from OpenRouter response.", JSON.stringify(response.data, null, 2));
            const errorMessage = response.data?.error?.message || "Unknown error structure";
            return `(Error: ${errorMessage})`;
        }
    } catch (error) {
        console.error("Error calling OpenRouter API:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) { return "(API Timeout)"; }
        const errorMessage = error.response?.data?.error?.message || error.message;
        return `(API Error: ${errorMessage.substring(0, 50)})`;
    }
}

// --- Trait Constants ---
// Base trait options
const INTELLIGENCE_LEVELS = ["low", "average", "high"];
const MOODS = ["happy", "sad", "neutral", "curious", "annoyed"];
const OPENNESS_TRAITS = ["low", "medium", "high"];
const AGREEABLENESS_TRAITS = ["low", "medium", "high"];
const SOCIAL_TRAITS = ["introverted", "extroverted", "ambiverted"];
const EMOTIONAL_TRAITS = ["calm", "anxious", "optimistic", "pessimistic"];
const GRAMMAR_MISTAKES = ["none", "few", "many"];
const CAPITAL_LETTER_USAGE = [true, false];
const PUNCTUATION_USAGE = [true, false];
const QUESTION_WORD_COUNT = ["3", "4", "5", "6", "7"];
const ANSWER_WORD_COUNT = ["1", "2", "3", "4", "5"];

// --- Additional trait variations with internet slang and casual styles ---

// Add more internet-style traits
const ADDITIONAL_INTELLIGENCE_LEVELS = [
    "u r super smart",
    "ur kinda dumb lol",
    "ur average intelligence",
    "u overthink everything"
];

const ADDITIONAL_MOODS = [
    "ur super hyped",
    "ur totally chill",
    "ur lowkey annoyed",
    "ur feeling meh",
    "ur kinda bored"
];

const ADDITIONAL_OPENNESS_TRAITS = [
    "ur super random",
    "ur basic af",
    "ur pretty deep",
    "ur very artsy"
];

const ADDITIONAL_AGREEABLENESS_TRAITS = [
    "ur super nice",
    "ur kinda harsh",
    "ur brutally honest",
    "ur pretty chill",
    "ur totally laid back"
];

const ADDITIONAL_SOCIAL_TRAITS = [
    "ur an introvert",
    "ur an extrovert",
    "ur awkward af",
    "ur too cool",
    "ur kinda quirky"
];

const ADDITIONAL_EMOTIONAL_TRAITS = [
    "ur sensitive af",
    "ur dead inside lol",
    "ur super dramatic",
    "ur chill bout everything",
    "ur super moody"
];

// Additional text style traits
const TEXT_STYLE_TRAITS = [
    "u sometimes use ALL CAPS for emphasis",
    "u use lots of !!!! sometimes",
    "u never capitalize anything",
    "u use ... a lot",
    "u use lol after sentences sometimes",
    "u use emojis sometimes but not here",
    "u abbreviate words like prob and def",
    "u occasionally stretch words like sooooo",
    "u replace 'to' with '2' and 'for' with '4'",
    "u skip vowels smtms",
    "u occasnlly mispel things"
];

// Helper function to get a random value from an array
function getRandomTraitValue(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// --- Function to generate random traits ---
function generateRandomTraits(isQuestion = false) {
    // Decide if we're using internet style (40% chance)
    const useInternetStyle = Math.random() < 0.4;
    
    // Select traits, possibly including internet-style ones
    const intelligenceOptions = useInternetStyle ? 
        [...INTELLIGENCE_LEVELS, ...ADDITIONAL_INTELLIGENCE_LEVELS] : 
        INTELLIGENCE_LEVELS;
        
    const moodOptions = useInternetStyle ? 
        [...MOODS, ...ADDITIONAL_MOODS] : 
        MOODS;
        
    const opennessOptions = useInternetStyle ? 
        [...OPENNESS_TRAITS, ...ADDITIONAL_OPENNESS_TRAITS] : 
        OPENNESS_TRAITS;
        
    const agreeablenessOptions = useInternetStyle ? 
        [...AGREEABLENESS_TRAITS, ...ADDITIONAL_AGREEABLENESS_TRAITS] : 
        AGREEABLENESS_TRAITS;
        
    const socialOptions = useInternetStyle ? 
        [...SOCIAL_TRAITS, ...ADDITIONAL_SOCIAL_TRAITS] : 
        SOCIAL_TRAITS;
        
    const emotionalOptions = useInternetStyle ? 
        [...EMOTIONAL_TRAITS, ...ADDITIONAL_EMOTIONAL_TRAITS] : 
        EMOTIONAL_TRAITS;
    
    // Generate the traits
    const traits = {
        intelligence: getRandomTraitValue(intelligenceOptions),
        mood: getRandomTraitValue(moodOptions),
        openness: getRandomTraitValue(opennessOptions),
        agreeableness: getRandomTraitValue(agreeablenessOptions),
        socialTrait: getRandomTraitValue(socialOptions),
        emotionalTrait: getRandomTraitValue(emotionalOptions),
        grammarMistakes: getRandomTraitValue(GRAMMAR_MISTAKES),
        capitalLetter: getRandomTraitValue(CAPITAL_LETTER_USAGE),
        punctuation: getRandomTraitValue(PUNCTUATION_USAGE),
        wordCount: isQuestion ? 
                   getRandomTraitValue(QUESTION_WORD_COUNT) : 
                   getRandomTraitValue(ANSWER_WORD_COUNT)
    };
    
    // Add an additional text style trait (20% chance)
    if (useInternetStyle && Math.random() < 0.2) {
        traits.textStyle = getRandomTraitValue(TEXT_STYLE_TRAITS);
    }
    
    return traits;
}

// --- Updated getAIQuestion Function ---
async function getAIQuestion(playerProfile, assignedPromptTemplate) {
    // Generate random personality traits for questions
    const traits = generateRandomTraits(true);
    const traitsString = buildTraitsString(traits);
    
    const promptData = { 
        playerName: playerProfile.name || "AI Player",
        traitsString: traitsString,
        wordCount: traits.wordCount || "5" // Default to 5 if not set
    };
    
    // Use the provided template, default to standard if missing
    const template = assignedPromptTemplate || QUESTION_PROMPT_TEMPLATE;
    
    // Fill the template with player name, traits, and word count
    const promptText = template
        .replace("%%PLAYER_NAME%%", promptData.playerName)
        .replace("%%TRAITS_STRING%%", promptData.traitsString)
        .replace(/%%WORD_COUNT%%/g, promptData.wordCount); // Replace ALL instances of word count

    const config = { max_tokens: 25, temperature: 0.8 };
    let generatedQuestion = await callAIAPI(promptText, config);

    // Post-processing
    if (generatedQuestion.length > 40) generatedQuestion = generatedQuestion.substring(0, 40).trim() + "?";
    generatedQuestion = generatedQuestion.replace(/^["']|["']$/g, "");
    if (!generatedQuestion.endsWith('?')) generatedQuestion += '?';
    
    // Validate word count - if significantly off, try to fix or use fallback
    const wordCount = countWords(generatedQuestion);
    const targetWordCount = parseInt(promptData.wordCount, 10);
    
    if (Math.abs(wordCount - targetWordCount) > 2 || 
        generatedQuestion.length < 5 || 
        generatedQuestion.toLowerCase().includes("error") || 
        generatedQuestion.toLowerCase().includes("blocked")) {
        console.warn(`Word count mismatch: Expected ${targetWordCount}, got ${wordCount}. Using fallback.`);
        return generateFallbackQuestion(targetWordCount);
    }
    
    // Log the traits and word count
    console.log(`AI Question with traits: ${JSON.stringify(traits)}`);
    console.log(`Generated question word count: ${wordCount}, target: ${targetWordCount}`);
    
    return generatedQuestion;
}

// --- Updated getAIAnswer Function ---
async function getAIAnswer(playerProfile, question, assignedPromptTemplate) {
    // Generate random personality traits for answers
    const traits = generateRandomTraits(false);
    const traitsString = buildTraitsString(traits);
    
    const promptData = { 
        playerName: playerProfile.name || "AI Player",
        questionText: question || "(No question)",
        traitsString: traitsString,
        wordCount: traits.wordCount || "3" // Default to 3 if not set
    };
    
    const template = assignedPromptTemplate || ANSWER_PROMPT_TEMPLATE;
    
    // Fill the template with player name, question, traits, and word count
    const promptText = template
        .replace("%%PLAYER_NAME%%", promptData.playerName)
        .replace("%%QUESTION_TEXT%%", promptData.questionText)
        .replace("%%TRAITS_STRING%%", promptData.traitsString)
        .replace(/%%WORD_COUNT%%/g, promptData.wordCount); // Replace ALL instances of word count

    const config = { max_tokens: 40, temperature: 0.7 };
    let generatedAnswer = await callAIAPI(promptText, config);

    // Post-processing
    if (generatedAnswer.length > 100) generatedAnswer = generatedAnswer.substring(0, 100).trim();
    generatedAnswer = generatedAnswer.replace(/^["']|["']$/g, "");
    
    // Remove trailing periods to match internet style
    generatedAnswer = removeTrailingPeriod(generatedAnswer);
    
    // Validate word count - if significantly off, try to fix or use fallback
    const wordCount = countWords(generatedAnswer);
    const targetWordCount = parseInt(promptData.wordCount, 10);
    
    if (Math.abs(wordCount - targetWordCount) > 2 || 
        generatedAnswer.length < 2 || 
        generatedAnswer.toLowerCase().includes("error") || 
        generatedAnswer.toLowerCase().includes("blocked")) {
        console.warn(`Word count mismatch: Expected ${targetWordCount}, got ${wordCount}. Using fallback.`);
        return generateFallbackAnswer(targetWordCount, question);
    }
    
    // Log the traits and word count
    console.log(`AI Answer with traits: ${JSON.stringify(traits)}`);
    console.log(`Generated answer word count: ${wordCount}, target: ${targetWordCount}`);
    
    return generatedAnswer;
}

// --- Helper function to count words ---
function countWords(text) {
    if (!text || typeof text !== 'string') return 0; // Add check for valid input
    return text.trim().split(/\s+/).filter(Boolean).length; // Filter empty strings from split
}

// --- Expanded fallback questions with internet language, typos, and casual speaking styles ---
const FALLBACK_QUESTIONS = {
    // 1-word questions
    1: [
        "why?",
        "srsly?",
        "thoughts?",
        "wut?",
        "rly?",
        "sup?",
        "how?",
        "y?",
        "hmm?",
        "huh?"
    ],
    
    // 2-word questions
    2: [
        "favorite food?",
        "wacha think?",
        "ur opinion?",
        "wat color?",
        "y tho?",
        "dream job?",
        "best day?",
        "worst fear?",
        "hot take?",
        "biggest regret?",
        "music taste?"
    ],
    
    // 3-word questions
    3: [
        "whats ur hobby?",
        "favorite childhood memory?",
        "best vacation ever?",
        "dogs or cats?",
        "ur perfect day?",
        "how u feeling?",
        "who inspires you?",
        "biggest life lesson?",
        "what u think?",
        "ever been scared?",
        "coffee or tea?",
        "most embarrassing moment?"
    ],
    
    // 4-word questions
    4: [
        "what makes u happy?",
        "ever feel like crying?",
        "wats ur biggest fear?",
        "do u like anime?",
        "how u handle failure?",
        "whats ur guilty pleasure?",
        "ever done something crazy?",
        "how u learn best?",
        "wats ur dream vacation?",
        "best memory from childhood?",
        "ever feel super lonely?"
    ],
    
    // 5-word questions
    5: [
        "how do u handle stress?",
        "whats ur fav movie ever?",
        "do u believe in ghosts?",
        "wats ur dream job rn?",
        "when were u most happy?",
        "do u talk to urself?",
        "r u morning or night?",
        "last song stuck in head?",
        "can u cook anything good?",
        "whats ur biggest pet peeve?",
        "wats ur daily routine like?"
    ],
    
    // 7-word questions
    7: [
        "wat do u do when ur sad?",
        "how do u deal with mean ppl?",
        "whats the last thing that made u cry?",
        "if u could time travel where to?",
        "do u think about the meaning of life?",
        "can u tell when someone is lying?",
        "wat would u do with a million dollars?",
        "wats something u wish u could change?",
        "how do u know if ur in love?",
        "do u believe everything happens for reason?"
    ]
};

// --- Expanded fallback answers with internet language, typos, and casual speaking styles ---
const FALLBACK_ANSWERS = {
    // 1-word answers
    1: [
        "idk",
        "yes",
        "no",
        "maybe",
        "sometimes",
        "absolutely",
        "never",
        "uhh",
        "hmm",
        "depends",
        "agreed",
        "nope",
        "yup",
        "obvs",
        "possibly",
        "dunno",
        "tru"
    ],
    
    // 2-word answers
    2: [
        "no way",
        "for sure",
        "not rly",
        "probably not",
        "i guess",
        "perhaps so",
        "sounds good",
        "totally agree",
        "very cool",
        "seems legit",
        "thats weird",
        "dunno tbh",
        "why tho",
        "i disagee",
        "never tried",
        "absolutely not",
        "yes definitely"
    ],
    
    // 3-word answers
    3: [
        "i dunno lol",
        "not rlly sure",
        "that sounds cool",
        "never thought bout",
        "no clue honestly",
        "i love that",
        "hate that tbh",
        "cant even remember",
        "makes me happy",
        "dont care much",
        "pretty cool tho",
        "sounds kinda lame",
        "very interesting question",
        "never considered it",
        "all the time"
    ],
    
    // 4-word answers
    4: [
        "i never thought bout that",
        "that's a good question",
        "not sure i know",
        "i rlly dont know",
        "cant say i have",
        "never happened to me",
        "thats hard to answer",
        "i kinda like it",
        "not my thing tbh",
        "makes me feel weird",
        "depends on the day",
        "wish i knew lol",
        "something i wonder about",
        "i'm still figuring out"
    ],
    
    // 5-word answers
    5: [
        "i never thought about that",
        "thats a rly good question",
        "i dont rlly know tbh",
        "wish i had an answer",
        "not something i think about",
        "that happens to me often",
        "never experienced that b4 honestly",
        "i cant decide on that",
        "its complicated to explain rly",
        "maybe sometimes but not always",
        "i change my mind alot",
        "depends on how im feeling",
        "ill have to think about it"
    ]
};

// Updated function to generate fallback questions
function generateFallbackQuestion(wordCount) {
    // Find the closest available word count
    const availableWordCounts = Object.keys(FALLBACK_QUESTIONS).map(Number);
    const closestWordCount = availableWordCounts.reduce((prev, curr) => {
        return (Math.abs(curr - wordCount) < Math.abs(prev - wordCount) ? curr : prev);
    }, availableWordCounts[0]);
    
    // Get options for that word count
    const options = FALLBACK_QUESTIONS[closestWordCount];
    if (!options || options.length === 0) {
        // Ultimate fallback
        return "whats ur favorite thing?";
    }
    
    // Select a random option
    return options[Math.floor(Math.random() * options.length)];
}

// Updated function to generate fallback answers
function generateFallbackAnswer(wordCount, question) {
    // Find the closest available word count
    const availableWordCounts = Object.keys(FALLBACK_ANSWERS).map(Number);
    const closestWordCount = availableWordCounts.reduce((prev, curr) => {
        return (Math.abs(curr - wordCount) < Math.abs(prev - wordCount) ? curr : prev);
    }, availableWordCounts[0]);
    
    // Get options for that word count
    const options = FALLBACK_ANSWERS[closestWordCount];
    if (!options || options.length === 0) {
        // Ultimate fallback
        return wordCount <= 1 ? "idk" : "i dunno really";
    }
    
    // Select a random option
    let answer = options[Math.floor(Math.random() * options.length)];
    
    // Sometimes (1 in 3 chance) make minor modifications to introduce more variety
    if (Math.random() < 0.33) {
        answer = introduceRandomVariation(answer);
    }
    
    // Remove trailing periods if present
    answer = removeTrailingPeriod(answer);
    
    return answer;
}

/**
 * Removes trailing periods from text to make it look more casual/internet-like
 * Keeps other punctuation like ! and ? intact
 */
function removeTrailingPeriod(text) {
    if (!text) return text;
    
    // Simple case: if text ends with a period, remove it
    if (text.endsWith('.')) {
        return text.slice(0, -1);
    }
    
    // More complex case: if text ends with a period followed by a quote or space, remove the period
    if (text.endsWith('."') || text.endsWith('. ')) {
        return text.slice(0, -2) + text.slice(-1);
    }
    
    return text;
}

// Function to introduce random variations to fallback text
function introduceRandomVariation(text) {
    // Clone the input text
    let result = text;
    
    // 25% chance to remove an apostrophe
    if (Math.random() < 0.25 && result.includes("'")) {
        result = result.replace(/'/g, "");
    }
    
    // 25% chance to swap "you" with "u" or vice versa
    if (Math.random() < 0.25) {
        if (result.includes(" you ")) {
            result = result.replace(" you ", " u ");
        } else if (result.includes(" u ")) {
            result = result.replace(" u ", " you ");
        }
    }
    
    // 15% chance to introduce a typo
    if (Math.random() < 0.15) {
        const words = result.split(" ");
        if (words.length > 0) {
            const randomWordIndex = Math.floor(Math.random() * words.length);
            // Only modify words longer than 3 characters
            if (words[randomWordIndex].length > 3) {
                const charToModify = Math.floor(Math.random() * (words[randomWordIndex].length - 1)) + 1;
                // Swap two adjacent characters
                const chars = words[randomWordIndex].split('');
                [chars[charToModify], chars[charToModify-1]] = [chars[charToModify-1], chars[charToModify]];
                words[randomWordIndex] = chars.join('');
                result = words.join(" ");
            }
        }
    }
    
    return result;
}

// Function to build a traits string from a traits object
function buildTraitsString(traits) {
    // Build the base traits string
    let traitsString = `Intelligence level: ${traits.intelligence || 'average'}
Mood: ${traits.mood || 'neutral'}
Openness to Experience: ${traits.openness || 'medium'}
Agreeableness: ${traits.agreeableness || 'medium'}
Social Traits: ${traits.socialTrait || 'ambiverted'}
Emotional Traits: ${traits.emotionalTrait || 'calm'}
Amount of grammatical mistakes in your text: ${traits.grammarMistakes || 'none'}
Your text starts with capital letter: ${traits.capitalLetter === undefined ? true : traits.capitalLetter}
You use punctuation marks: ${traits.punctuation === undefined ? true : traits.punctuation}`;

    // Add text style if present
    if (traits.textStyle) {
        traitsString += `\nWriting style: ${traits.textStyle}`;
    }
    
    return traitsString;
}

// --- getAIVote Function ---
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
         .replace("%%PLAYER_NAME%%", promptData.playerName)
         .replace("%%QUESTION_TEXT%%", promptData.questionText)
         .replace("%%OTHER_PLAYERS_ANSWERS%%", promptData.otherPlayersAnswers);

    const config = { max_tokens: 25, temperature: 0.5 };
    let votedPlayerId = await callAIAPI(promptText, config);

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

module.exports = {
    // Core AI functions
    getAIQuestion,
    getAIAnswer,
    getAIVote,
    callAIAPI,
    
    // Trait variables
    INTELLIGENCE_LEVELS,
    MOODS,
    OPENNESS_TRAITS,
    AGREEABLENESS_TRAITS,
    SOCIAL_TRAITS,
    EMOTIONAL_TRAITS,
    GRAMMAR_MISTAKES,
    CAPITAL_LETTER_USAGE,
    PUNCTUATION_USAGE,
    ANSWER_WORD_COUNT,
    QUESTION_WORD_COUNT,
    
    // Additional internet-style traits (if defined)
    ...(typeof ADDITIONAL_INTELLIGENCE_LEVELS !== 'undefined' ? { ADDITIONAL_INTELLIGENCE_LEVELS } : {}),
    ...(typeof ADDITIONAL_MOODS !== 'undefined' ? { ADDITIONAL_MOODS } : {}),
    ...(typeof ADDITIONAL_OPENNESS_TRAITS !== 'undefined' ? { ADDITIONAL_OPENNESS_TRAITS } : {}),
    ...(typeof ADDITIONAL_AGREEABLENESS_TRAITS !== 'undefined' ? { ADDITIONAL_AGREEABLENESS_TRAITS } : {}),
    ...(typeof ADDITIONAL_SOCIAL_TRAITS !== 'undefined' ? { ADDITIONAL_SOCIAL_TRAITS } : {}),
    ...(typeof ADDITIONAL_EMOTIONAL_TRAITS !== 'undefined' ? { ADDITIONAL_EMOTIONAL_TRAITS } : {}),
    ...(typeof TEXT_STYLE_TRAITS !== 'undefined' ? { TEXT_STYLE_TRAITS } : {}),
    
    // Fallback libraries (if defined)
    ...(typeof FALLBACK_QUESTIONS !== 'undefined' ? { FALLBACK_QUESTIONS } : {}),
    ...(typeof FALLBACK_ANSWERS !== 'undefined' ? { FALLBACK_ANSWERS } : {}),
    
    // Helper functions
    generateRandomTraits,
    buildTraitsString,
    removeTrailingPeriod,
    ...(typeof countWords !== 'undefined' ? { countWords } : {}),
    ...(typeof generateFallbackQuestion !== 'undefined' ? { generateFallbackQuestion } : {}),
    ...(typeof generateFallbackAnswer !== 'undefined' ? { generateFallbackAnswer } : {}),
    ...(typeof introduceRandomVariation !== 'undefined' ? { introduceRandomVariation } : {}),
    
    // Templates
    QUESTION_PROMPT_TEMPLATE,
    ANSWER_PROMPT_TEMPLATE,
    VOTE_PROMPT_TEMPLATE,
    
    // Arrays for backward compatibility 
    QUESTION_PROMPTS: [QUESTION_PROMPT_TEMPLATE],
    ANSWER_PROMPTS: [ANSWER_PROMPT_TEMPLATE]
};
