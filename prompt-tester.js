// prompt-tester.js - A simple tool to test the AI prompts with different traits
require('dotenv').config();
const aiController = require('./gemini_ai');
console.log("Available in AI controller:", Object.keys(aiController));

// Function to generate and test question prompts
async function testQuestionPrompt() {
    // Create a mock player profile
    const playerProfile = {
        name: "TestPlayer123",
        id: "test-123"
    };

    // Get a random prompt with traits
    const traits = aiController.generateRandomTraits(true);
    const traitsString = aiController.buildTraitsString(traits);

    // Log the traits being used
    console.log("\n===== Testing Question Prompt =====");
    console.log("Using traits:");
    console.log(traitsString);

    // Fill the template
    const template = aiController.QUESTION_PROMPT_TEMPLATE;
    const promptText = template
        .replace("%%PLAYER_NAME%%", playerProfile.name)
        .replace("%%TRAITS_STRING%%", traitsString);

    // Log the full prompt
    console.log("\nFull prompt:");
    console.log(promptText);

    // Try to generate a question
    try {
        const question = await aiController.getAIQuestion(playerProfile);
        console.log("\nGenerated question:");
        console.log(question);
    } catch (error) {
        console.error("Error generating question:", error);
    }
}

// Function to generate and test answer prompts
async function testAnswerPrompt() {
    // Create a mock player profile
    const playerProfile = {
        name: "TestPlayer123",
        id: "test-123"
    };

    // Sample question
    const question = "What do you think about technology?";

    // Get a random prompt with traits
    const traits = aiController.generateRandomTraits(false);
    const traitsString = aiController.buildTraitsString(traits);

    // Log the traits being used
    console.log("\n===== Testing Answer Prompt =====");
    console.log("Using traits:");
    console.log(traitsString);

    // Fill the template
    const template = aiController.ANSWER_PROMPT_TEMPLATE;
    const promptText = template
        .replace("%%PLAYER_NAME%%", playerProfile.name)
        .replace("%%QUESTION_TEXT%%", question)
        .replace("%%TRAITS_STRING%%", traitsString);

    // Log the full prompt
    console.log("\nFull prompt:");
    console.log(promptText);

    // Try to generate an answer
    try {
        const answer = await aiController.getAIAnswer(playerProfile, question);
        console.log("\nGenerated answer:");
        console.log(answer);
    } catch (error) {
        console.error("Error generating answer:", error);
    }
}

// Run tests
async function runTests() {
    await testQuestionPrompt();
    await testAnswerPrompt();
}

// Run if executed directly
if (require.main === module) {
    console.log("Starting AI prompt tests...");
    runTests()
        .then(() => console.log("\nTests completed"))
        .catch(err => console.error("Test error:", err))
        .finally(() => console.log("Test run finished"));
}

module.exports = {
    testQuestionPrompt,
    testAnswerPrompt,
    runTests
};
