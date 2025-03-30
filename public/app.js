// app.js (Corrected Again - Focused on Stability)
console.log("App.js loading...");

// --- DOM Element References ---
// Use functions to get elements, allows script to load even if DOM isn't fully ready? (Less likely needed now but safer)
const getElem = (id) => document.getElementById(id);
const statusMessage = getElem('status-message');
const timerDisplay = getElem('timer-display');
const gameArea = getElem('game-area');
const playerList = getElem('player-list');
const questionDisplay = getElem('question-display');
const answerArea = getElem('answer-area');
const inputArea = getElem('input-area');
const inputLabel = getElem('input-label');
const gameInput = getElem('game-input');
const submitButton = getElem('submit-button');
const rulesBox = getElem('rules-box');

// --- Client State ---
let isInGame = false;
let myPlayerId = null;
let currentPlayers = [];
let currentPhase = null;
let currentAskerId = null;
let phaseEndTime = 0;
let timerInterval = null;
let hasVotedThisRound = false;
let eliminatedPlayerRoles = {}; // { playerId: boolean (isHuman) }
const QUESTION_MAX_LENGTH = 40;
const ANSWER_MAX_LENGTH = 100;

// --- Socket.IO Connection ---
// Ensure io() is called after the library is loaded
let socket;
try {
     socket = io();
     console.log("Socket.IO initialized.");
} catch (err) {
     console.error("Failed to initialize Socket.IO. Is the library included correctly?", err);
     if (statusMessage) statusMessage.textContent = "Error loading game library.";
     // Stop further execution if socket fails
     throw new Error("Socket.IO init failed");
}


// --- Helper Functions ---
function updateTimerDisplay() {
    const now = Date.now();
    const endTime = typeof phaseEndTime === 'number' ? phaseEndTime : now;
    const timeLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
    if (timerDisplay) { // Check element exists
        timerDisplay.textContent = `Time left: ${timeLeft}s`;
    }
    if (timeLeft <= 0) {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (timerDisplay) { timerDisplay.textContent = "Time's up!"; }
    }
}

function startTimer(durationSeconds) {
    if (timerInterval) { clearInterval(timerInterval); }
    const durationMs = (typeof durationSeconds === 'number' && durationSeconds > 0) ? durationSeconds * 1000 : 0;
    phaseEndTime = Date.now() + durationMs;
    updateTimerDisplay(); // Update immediately
    if (durationMs > 0) {
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (timerDisplay) { timerDisplay.textContent = ''; } // Check element
}

function renderEmojiAvatar(emojiString) {
    const avatarSpan = document.createElement('span');
    avatarSpan.textContent = emojiString || '❓';
    return avatarSpan;
}

// Consolidated Render/UI Update Function
function updateGameUI(players, displayData = {}) {
    if (!playerList) { console.error("Player list element not found for update"); return; }
    playerList.innerHTML = ''; // Clear previous list
    if (!Array.isArray(players)) { console.error("Invalid players data for update"); return; }

    console.log(`Updating UI for phase: ${currentPhase || 'N/A'}. Data:`, displayData);

    players.forEach(player => {
        if (!player || typeof player.id === 'undefined') { console.warn("Skipping invalid player data", player); return; }

        const playerCard = document.createElement('div');
        playerCard.classList.add('player-card');
        playerCard.dataset.playerId = player.id;
        playerCard.classList.remove('current-asker', 'eliminated-card'); // Reset dynamic classes

        // Apply base status classes
        if (player.status !== 'active') { playerCard.classList.add('eliminated'); }
        if (player.id === myPlayerId) { playerCard.classList.add('is-me'); }

        // Create elements (safer checks inside)
        const avatarContainer = document.createElement('div'); avatarContainer.classList.add('avatar-container');
        const avatarElement = renderEmojiAvatar(player.avatarEmoji); avatarContainer.appendChild(avatarElement);

        const nameElement = document.createElement('span'); nameElement.classList.add('player-name'); nameElement.textContent = player.name || '???'; if (player.id === myPlayerId) nameElement.textContent += " (You)";

        const roleLabelElement = document.createElement('span'); roleLabelElement.classList.add('player-role-label'); roleLabelElement.style.display = 'none'; // Hide initially

        const thinkingSpan = document.createElement('span'); thinkingSpan.classList.add('thinking-indicator'); thinkingSpan.style.display = 'none';

        const detailsElement = document.createElement('p'); detailsElement.classList.add('player-details'); detailsElement.style.display = 'none';

        const voteButtonContainer = document.createElement('div'); voteButtonContainer.classList.add('vote-button-container'); voteButtonContainer.style.display = 'none';

        // Append elements
        playerCard.appendChild(avatarContainer); playerCard.appendChild(nameElement); playerCard.appendChild(roleLabelElement); playerCard.appendChild(thinkingSpan); playerCard.appendChild(detailsElement); playerCard.appendChild(voteButtonContainer);
        playerList.appendChild(playerCard);

        // --- Phase-specific content within the card ---

        // Show persistent role label if eliminated
        if (player.status !== 'active' && eliminatedPlayerRoles.hasOwnProperty(player.id)) {
            const isHuman = eliminatedPlayerRoles[player.id];
            roleLabelElement.textContent = isHuman ? '❌Human' : '😅AI';
            roleLabelElement.style.display = 'block';
        }

        // Content for VOTING phase
        if (currentPhase === 'VOTING') {
             detailsElement.classList.add('is-answer'); // Add answer style class
             const answerInfo = displayData.answers?.[player.id];
             if (answerInfo) { detailsElement.textContent = `"${answerInfo.answer}"`; }
             else if (player.id === currentAskerId) { detailsElement.textContent = `(Asker)`; }
             else { detailsElement.textContent = `(No Ans)`; }
             detailsElement.style.display = 'block';

             if (player.status === 'active') { // Add vote button if active
                 voteButtonContainer.innerHTML = ''; voteButtonContainer.style.display = 'block';
                 const voteButton = document.createElement('button'); voteButton.classList.add('vote-button'); voteButton.dataset.votedPlayerId = player.id; voteButton.textContent = `That's AI!`;
                 if (hasVotedThisRound) { voteButton.disabled = true; }
                 voteButtonContainer.appendChild(voteButton);
                 // Show thinking indicator if haven't voted
                  if (thinkingSpan && !hasVotedThisRound) { thinkingSpan.style.display = 'inline-block'; }
             }
        }
        // Content for REVEAL phase
        else if (currentPhase === 'REVEAL') {
            detailsElement.classList.remove('is-answer'); // Remove answer style
            const results = displayData.results || {};
            const voteInfo = results.votes || {};
            const voteCount = results.voteCounts?.[player.id] || 0;
            let revealText = `Votes: ${voteCount}`;
            const voters = [];
            for (const voterId in voteInfo) { if (voteInfo[voterId] === player.id) { const voter = players.find(p => p.id === voterId); voters.push(voter?.name || '???'); } }
            if (voters.length > 0) { revealText += ` (from ${voters.join(', ')})`; }
            detailsElement.innerHTML = revealText;
            detailsElement.style.display = 'block';

            // Highlight if eliminated this round
             const eliminatedInfo = results.eliminatedDetails?.find(e => e.id === playerId);
             if (eliminatedInfo) {
                 playerCard.classList.add('eliminated-card');
                 // Role label is handled above by checking status
             }
        }
         // Content for ASKING/ANSWERING phase (Thinking indicators)
         else if (currentPhase === 'ASKING' && player.id === currentAskerId && player.id !== myPlayerId) {
             if (thinkingSpan) thinkingSpan.style.display = 'inline-block';
         } else if (currentPhase === 'ANSWERING' && player.status === 'active' && player.id !== currentAskerId) {
              if (thinkingSpan) thinkingSpan.style.display = 'inline-block';
         }
    });
}


function handleSubmit() {
    if (!gameInput || !submitButton) { console.error("Input elements missing"); return; }
    const inputValue = gameInput.value.trim();
    const currentSubmitPhase = currentPhase; // Capture phase at time of submit attempt

    // Disable UI immediately
    gameInput.disabled = true;
    submitButton.disabled = true;
    hideMyThinkingIndicator(); // Hide indicator early

    if (currentSubmitPhase === 'ASKING') {
        if (!inputValue) { alert("Please enter a question."); gameInput.disabled = false; submitButton.disabled = false; return; } // Re-enable on simple validation fail
        if (inputValue.length > QUESTION_MAX_LENGTH) { alert(`Max ${QUESTION_MAX_LENGTH} chars.`); gameInput.disabled = false; submitButton.disabled = false; return; }
        console.log('Submitting question:', inputValue); socket.emit('submit_question', inputValue); submitButton.textContent = 'Sent';
    } else if (currentSubmitPhase === 'ANSWERING') {
        if (!inputValue) { alert("Please enter an answer."); gameInput.disabled = false; submitButton.disabled = false; return; }
        if (inputValue.length > ANSWER_MAX_LENGTH) { alert(`Max ${ANSWER_MAX_LENGTH} chars.`); gameInput.disabled = false; submitButton.disabled = false; return; }
        console.log('Submitting answer:', inputValue); socket.emit('submit_answer', inputValue); submitButton.textContent = 'Sent';
    } else {
         // If phase changed before submit processed, maybe don't send anything
         console.warn(`Submit button clicked but phase is no longer ${currentSubmitPhase}, it's ${currentPhase}. Ignoring.`);
          gameInput.disabled = false; // Re-enable just in case
          submitButton.disabled = false;
    }
}

function hideThinkingIndicator(playerId) {
    if (!playerList || !playerId) return;
    const playerCard = playerList.querySelector(`.player-card[data-player-id="${playerId}"]`);
    if (playerCard) {
        const indicator = playerCard.querySelector('.thinking-indicator');
        if (indicator) indicator.style.display = 'none';
    }
}
function hideMyThinkingIndicator() { hideThinkingIndicator(myPlayerId); }

// --- Socket.IO Event Listeners ---
socket.on('connect', () => {
    console.log('Socket connected! ID:', socket.id);
    isInGame = false; myPlayerId = null; currentPlayers = []; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    // Safely update UI elements
    if (gameArea) gameArea.style.display = 'none'; if (inputArea) inputArea.style.display = 'none'; if (playerList) playerList.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = ''; if (answerArea) answerArea.innerHTML = ''; stopTimer();
    if (statusMessage) statusMessage.innerHTML = 'Connected! Waiting...'; // Clear any previous dots
    if (rulesBox) rulesBox.style.display = 'block';
    document.body.classList.remove('game-over');
});
socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason); if (statusMessage) statusMessage.innerHTML = 'Disconnected. Refresh?';
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    if (gameArea) gameArea.style.display = 'none'; if (inputArea) inputArea.style.display = 'none'; if (rulesBox) rulesBox.style.display = 'none';
    stopTimer();
});
socket.on('connect_error', (error) => {
    console.error('Socket Connection Error:', error); if (statusMessage) statusMessage.innerHTML = 'Connection Failed.';
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    if (rulesBox) rulesBox.style.display = 'none'; stopTimer();
});

socket.on('waiting_player_count', (count) => {
    if (!isInGame && statusMessage) {
        const maxPlayers = 3;
        statusMessage.innerHTML = `Waiting for Human Players (${count}/${maxPlayers}<span class="waiting-dots"></span>)<br>Game starts when 3 humans join.`;
        if (rulesBox) rulesBox.style.display = 'block';
        if (gameArea) gameArea.style.display = 'none';
    }
});

socket.on('game_start', (initialData) => {
    console.log('Game Start received:', initialData); if (!initialData?.yourPlayerId || !Array.isArray(initialData.players)) { console.error("Invalid game_start data"); return; }
    isInGame = true; myPlayerId = initialData.yourPlayerId; currentPlayers = initialData.players; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    console.log("My ID:", myPlayerId); if (statusMessage) statusMessage.innerHTML = `Game #${initialData.gameId} starting...`;
    if (gameArea) gameArea.style.display = 'block'; if (inputArea) inputArea.style.display = 'none'; if (answerArea) answerArea.innerHTML = ''; if (questionDisplay) questionDisplay.textContent = '';
    if (rulesBox) rulesBox.style.display = 'none';
    updateGameUI(currentPlayers); // Use consolidated update function
    stopTimer();
});

socket.on('new_round_phase', (data) => {
    console.log('New Phase received:', data?.phase, data); if (!data?.phase || typeof data.duration === 'undefined') { console.error("Invalid phase data"); return; }

    currentPhase = data.phase; hasVotedThisRound = false; startTimer(data.duration);
    currentAskerId = data.askerId || null; // Store asker ID for the phase

    // Reset common UI elements (ensure safe access)
    if (questionDisplay) questionDisplay.innerHTML = ''; // Use innerHTML to clear potential span
    if (inputArea) inputArea.style.display = 'none';
    if (gameInput) { gameInput.disabled = false; gameInput.value = ''; }
    if (submitButton) { submitButton.disabled = false; }
    if (rulesBox) rulesBox.style.display = 'none';
    if (statusMessage && statusMessage.querySelector('.waiting-dots')) { statusMessage.textContent = statusMessage.textContent; } // Clear waiting dots if present


    // --- Update Status Message FIRST ---
    let statusText = `Round ${data.round || '?'}: `;
    if (currentPhase === 'ASKING') {
        statusText += `${data.askerName || '?'} is asking<span class="waiting-dots"></span>`;
    }
    else if (currentPhase === 'ANSWERING') statusText += `Answer!`;
    else if (currentPhase === 'VOTING') statusText += `Vote!`;
    else if (currentPhase === 'REVEAL') statusText += `Reveal!`;
    else statusText += currentPhase; // Fallback
    if (statusMessage) statusMessage.innerHTML = statusText;

    // --- Update Question Display ---
     if (questionDisplay) {
         if (currentPhase === 'ASKING') questionDisplay.innerHTML = `Waiting for ${data.askerName || '?'}<span class="waiting-dots"></span>`;
         else if (currentPhase === 'ANSWERING' || currentPhase === 'VOTING') questionDisplay.textContent = `Q (${data.askerName || '?'}): ${data.question || '...'}`;
         else if (currentPhase === 'REVEAL') {
              // Display results summary in status, maybe keep question here?
              if (data.results) {
                  const elimDetails = data.results.eliminatedDetails || [];
                  const elimNames = elimDetails.map(e => e.name);
                  statusMessage.textContent = elimNames.length > 0 ? `Eliminated: ${elimNames.join(', ')}!` : `Nobody eliminated!`;
              } else {
                   statusMessage.textContent = `Round ${data.round}: Results...`;
              }
              // Keep question displayed during reveal? Optional.
              // questionDisplay.textContent = `Q: ${data.question || '...'}`;
         } else {
              questionDisplay.textContent = ''; // Clear for other states
         }
     }

    // --- Store Roles if Reveal Phase ---
    if (currentPhase === 'REVEAL' && data.results?.eliminatedDetails) {
        data.results.eliminatedDetails.forEach(detail => { if (detail?.id != null && detail.isHuman != null) { eliminatedPlayerRoles[detail.id] = detail.isHuman; } });
        if (Array.isArray(data.players)) { currentPlayers = data.players; } // Update player status from payload
    }

    // --- Update Player List & Phase Specific UI ---
    updateGameUI(currentPlayers, { answers: data.answers, results: data.results });

    // --- Show/Hide Input Area ---
    if (inputArea) {
         if (currentPhase === 'ASKING' && data.askerId === myPlayerId) {
             if(inputLabel) inputLabel.textContent=`Ask (max ${QUESTION_MAX_LENGTH}):`; if(submitButton) submitButton.textContent='Submit Q'; if(gameInput) gameInput.placeholder='Question...'; if(gameInput) gameInput.maxLength = QUESTION_MAX_LENGTH;
             inputArea.style.display = 'block';
         } else if (currentPhase === 'ANSWERING' && data.askerId !== myPlayerId) {
              if(inputLabel) inputLabel.textContent=`Your answer:`; if(submitButton) submitButton.textContent='Submit A'; if(gameInput) gameInput.placeholder='Answer...'; if(gameInput) gameInput.maxLength = ANSWER_MAX_LENGTH;
             inputArea.style.display = 'block';
         } else {
             inputArea.style.display = 'none'; // Hide otherwise
         }
    }

});


socket.on('player_update', (data) => {
    if (!isInGame) return; console.log("P Update:", data);
    if (data?.players) { currentPlayers = data.players; updateGameUI(currentPlayers); } // Use consolidated update
});
socket.on('game_over', (data) => {
    if (!isInGame) return; console.log("Game Over:", data); isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {}; stopTimer();
    if (inputArea) inputArea.style.display = 'none'; if (statusMessage) statusMessage.innerHTML = `Game Over! ${data?.reason || ''}`; document.body.classList.add('game-over'); if (rulesBox) rulesBox.style.display = 'none';
});
socket.on('action_error', (data) => {
    console.warn("Action Err:", data); if (data?.message) alert(`Err: ${data.message}`);
    // Re-enable input if appropriate phase/player
    const myTurnToAsk = currentPhase === 'ASKING' && myPlayerId === currentAskerId;
    const myTurnToAnswer = currentPhase === 'ANSWERING' && myPlayerId !== currentAskerId;
    if (myTurnToAsk || myTurnToAnswer) {
         if (gameInput) gameInput.disabled = false; if (submitButton) { submitButton.disabled = false; submitButton.textContent = myTurnToAsk ? 'Submit Q' : 'Submit A'; }
    }
});
socket.on('vote_accepted', () => {
    console.log("Vote Acc."); hasVotedThisRound = true; if (statusMessage) statusMessage.textContent = "Vote cast! Waiting..."; document.querySelectorAll('.vote-button').forEach(b => { b.disabled = true; }); hideMyThinkingIndicator();
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Use safe accessors in case elements aren't ready immediately
    const submitBtn = getElem('submit-button');
    const gameIn = getElem('game-input');
    const pList = getElem('player-list');

    if (submitBtn) { submitBtn.addEventListener('click', handleSubmit); } else { console.error("Submit btn missing"); }
    if (gameIn) { gameIn.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }); } else { console.error("Input missing"); }
    if (pList) {
        pList.addEventListener('click', (event) => {
            const voteButton = event.target.closest('.vote-button');
            if (voteButton && currentPhase === 'VOTING' && !hasVotedThisRound && !voteButton.disabled) {
                const votedPlayerId = voteButton.dataset.votedPlayerId;
                if (votedPlayerId) {
                    console.log(`Voting for ${votedPlayerId}`); socket.emit('submit_vote', { votedId: votedPlayerId });
                    document.querySelectorAll('.vote-button').forEach(btn => { btn.disabled = true; });
                    hideMyThinkingIndicator();
                }
            }
        });
    } else { console.error("PlayerList missing!"); }
}

// Initial setup & Connection Check
// Defer setup until DOM is loaded
if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', setupEventListeners);
} else {
     setupEventListeners(); // DOM already loaded
}
console.log("App.js loaded.");
setTimeout(() => { if (!socket.connected) console.error("Socket Connect Fail!"); else console.log("Socket connected."); }, 3000); // Increased timeout slightly