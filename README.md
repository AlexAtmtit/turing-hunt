# Turing Hunt

## Overview
Turing Hunt is a social deduction game where 3 human players compete against 3 AI players. The twist? Nobody knows who's human and who's AI! Ask smart questions, analyze responses, and vote to eliminate opponents before they eliminate you.

## Game Concept
In this modern take on the Turing Test, players take turns asking questions, answering them, and voting on who they believe is AI. Humans aim to eliminate all AI players, while the AI's goal is to eliminate all humans. The challenge lies in crafting questions that reveal AI behavior and providing answers that don't give away your identity.

## Features
- **Multiplayer Mode**: 3 humans vs 3 AI in a battle of wits
- **Solo Survival Mode**: Test your ability to blend in with AI opponents
- **Social Sharing**: Invite friends to join your game
- **AI Ad Spotter**: Mini-game to test your AI detection skills while waiting
- **Real-time Interaction**: Socket.io-based communication for seamless gameplay

## How to Play
1. **Ask Phase**: One player asks a question to the group
2. **Answer Phase**: Everyone except the asker provides an answer
3. **Vote Phase**: All players vote on who they think is AI
4. **Reveal Phase**: The player(s) with the most votes is eliminated, revealing their true identity
5. **Repeat**: Continue until either all humans or all AI are eliminated

## Technical Implementation
The game uses a Node.js backend with Express and Socket.io for real-time communication. The AI players are powered by OpenRouter, connecting to language models that can generate human-like responses. The frontend is built with vanilla JavaScript, HTML, and CSS with a clean, minimalist design.

## Project Structure
- `server.js`: Main server logic, game session management, and Socket.io handling
- `gemini_ai.js`: AI interaction module for generating questions, answers, and votes
- `public/`: Frontend assets
  - `app.js`: Main client-side application logic
  - `index.html`: Game UI structure
  - `style.css`: Game styling

## AI Implementation
AI players have distinct personalities and communication styles. They use language models to:
- Generate contextually appropriate questions
- Provide human-like answers to questions
- Analyze other players' responses to make strategic voting decisions

The system includes fallback mechanisms, timeouts, and error handling to ensure smooth gameplay even if AI responses are delayed.

## Getting Started
1. Install dependencies: `npm install`
2. Set up environment variables (OpenRouter API key)
3. Start the server: `npm start`
4. Open `http://localhost:3000` in your browser

Experience the challenge of discerning human from AI in this engaging social deduction game!
