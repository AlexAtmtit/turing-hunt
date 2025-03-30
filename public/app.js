// app.js
console.log("App.js loading...");

// --- DOM Element References ---
const statusMessage = document.getElementById('status-message');
const timerDisplay = document.getElementById('timer-display');
const gameArea = document.getElementById('game-area');
const playerList = document.getElementById('player-list'); // Parent for event delegation
const questionDisplay = document.getElementById('question-display');
const answerArea = document.getElementById('answer-area'); // Can likely remove this element later
const inputArea = document.getElementById('input-area');
const inputLabel = document.getElementById('input-label');
const gameInput = document.getElementById('game-input');
const submitButton = document.getElementById('submit-button');

// --- Client State ---
let isInGame = false;
let myPlayerId = null;
let currentPlayers = [];
let currentPhase = null;
let currentAskerId = null;
let phaseEndTime = 0;
let timerInterval = null;
let hasVotedThisRound = false; // Added flag
const QUESTION_MAX_LENGTH = 40;
const ANSWER_MAX_LENGTH = 100;

// --- Socket.IO Connection ---
const socket = io();

// --- Helper Functions ---
function updateTimerDisplay() {
    const now = Date.now();
    const endTime = typeof phaseEndTime === 'number' ? phaseEndTime : Date.now();
    const timeLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
    if (timerDisplay) {
        timerDisplay.textContent = `Time left: ${timeLeft}s`;
    }
    if (timeLeft <= 0) {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (timerDisplay) {
            timerDisplay.textContent = "Time's up!";
        }
    }
}

function startTimer(durationSeconds) {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    const durationMs = (typeof durationSeconds === 'number' && durationSeconds > 0) ? durationSeconds * 1000 : 0;
    phaseEndTime = Date.now() + durationMs;
    updateTimerDisplay();
    if (durationMs > 0) {
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (timerDisplay) {
        timerDisplay.textContent = '';
    }
}

function renderAvatar(avatarData) {
    const safeAvatarData = avatarData || {};
    const color1 = safeAvatarData.color1 || '#cccccc';
    const color2 = safeAvatarData.color2 || '#aaaaaa';
    const shape = safeAvatarData.shape || 'square';
    const eyeStyle = safeAvatarData.eyeStyle || 'dots';

    const avatarDiv = document.createElement('div');
    avatarDiv.style.width = '40px';
    avatarDiv.style.height = '40px';
    avatarDiv.style.marginRight = '10px';
    avatarDiv.style.backgroundColor = color1;
    avatarDiv.style.border = `3px solid ${color2}`;
    avatarDiv.style.position = 'relative';
    avatarDiv.style.marginBottom = '5px';
    avatarDiv.style.boxSizing = 'border-box';

    if (shape === 'circle') {
        avatarDiv.style.borderRadius = '50%';
    } else if (shape === 'square') {
        avatarDiv.style.borderRadius = '5px';
    } else if (shape === 'triangle') {
        avatarDiv.style.width = '0px';
        avatarDiv.style.height = '0px';
        avatarDiv.style.backgroundColor = 'transparent';
        const triangleBase = 40; // Base width/height roughly
        const triangleSide = triangleBase / 2;
        avatarDiv.style.borderLeft = `${triangleSide}px solid transparent`;
        avatarDiv.style.borderRight = `${triangleSide}px solid transparent`;
        avatarDiv.style.borderBottom = `${triangleBase}px solid ${color1}`;
        // Reset other potentially conflicting styles explicitly
        avatarDiv.style.borderTopWidth = '0px';
        avatarDiv.style.borderWidth = `0 ${triangleSide}px ${triangleBase}px ${triangleSide}px`;
        avatarDiv.style.borderColor = 'transparent';
        avatarDiv.style.borderBottomColor = color1;
         avatarDiv.style.backgroundColor = ''; // Clear background just in case
         avatarDiv.style.border = ''; // Clear border just in case
    }

    if (shape !== 'triangle') {
        const eyeSpan = document.createElement('span');
        eyeSpan.textContent = eyeStyle === 'dots' ? '..' : '--';
        eyeSpan.style.position = 'absolute';
        eyeSpan.style.top = '8px';
        eyeSpan.style.left = '50%';
        eyeSpan.style.transform = 'translateX(-50%)';
        eyeSpan.style.color = color2;
        eyeSpan.style.fontSize = '12px';
        eyeSpan.style.zIndex = '1';
        avatarDiv.appendChild(eyeSpan);
    }
    return avatarDiv;
}

// Renders the player list, calling phase-specific UI setup functions
function renderPlayerList(players, displayData = {}) {
    if (!playerList) { console.error("Player list element not found"); return; }
    playerList.innerHTML = '';
    if (!Array.isArray(players)) { console.error("Invalid players data for render"); return; }

    players.forEach(player => {
        if (!player || typeof player.id === 'undefined') { console.warn("Skipping invalid player data", player); return; }

        const playerCard = document.createElement('div');
        playerCard.classList.add('player-card');
        playerCard.dataset.playerId = player.id;
        playerCard.classList.remove('current-asker', 'eliminated-card'); // Reset dynamic classes

        if (player.status !== 'active') { playerCard.classList.add('eliminated'); }
        if (player.id === myPlayerId) { playerCard.classList.add('is-me'); }
        if (player.id === currentAskerId && currentPhase !== 'REVEAL') { playerCard.classList.add('current-asker'); }

        const avatarElement = renderAvatar(player.avatarData);
        const nameElement = document.createElement('span');
        nameElement.classList.add('player-name');
        nameElement.textContent = player.name || '???';
        if (player.id === myPlayerId) { nameElement.textContent += " (You)"; }

        const detailsElement = document.createElement('p');
        detailsElement.classList.add('player-details');
        detailsElement.style.display = 'none'; // Hide by default

        const voteButtonContainer = document.createElement('div');
        voteButtonContainer.classList.add('vote-button-container');
        voteButtonContainer.style.display = 'none';

        playerCard.appendChild(avatarElement);
        playerCard.appendChild(nameElement);
        playerCard.appendChild(detailsElement);
        playerCard.appendChild(voteButtonContainer);
        playerList.appendChild(playerCard);
    });

    // Call phase-specific UI setup after initial render
    if (currentPhase === 'VOTING' && displayData.answers) {
        setupVotingUI(displayData.answers);
    } else if (currentPhase === 'REVEAL' && displayData.results) {
        setupRevealUI(displayData.results);
    }
}

// Sets up UI for Voting Phase (displays answers, adds vote buttons)
function setupVotingUI(answers) {
    console.log("Setting up Voting UI with answers:", answers);
    document.querySelectorAll('.player-card').forEach(playerCard => {
        const playerId = playerCard.dataset.playerId;
        if (!playerId) return;
        const player = currentPlayers.find(p => p.id === playerId);
        if (!player) return;

        // Display Answer
        const detailsElement = playerCard.querySelector('.player-details');
        if (detailsElement) {
            detailsElement.classList.add('is-answer'); // Add class for potential styling
            if (answers[playerId]) {
                detailsElement.textContent = `"${answers[playerId].answer}"`;
            } else if (playerId === currentAskerId) {
                detailsElement.textContent = `(Asker)`;
            } else {
                detailsElement.textContent = `(No Answer)`;
            }
            detailsElement.style.display = 'block'; // Show it
        }

        // Add Vote Button (if player active)
        const voteButtonContainer = playerCard.querySelector('.vote-button-container');
        if (voteButtonContainer && player.status === 'active') {
            voteButtonContainer.innerHTML = ''; // Clear previous
            voteButtonContainer.style.display = 'block';
            const voteButton = document.createElement('button');
            voteButton.classList.add('vote-button');
            voteButton.dataset.votedPlayerId = player.id;
            voteButton.textContent = `Vote`;
            if (hasVotedThisRound) { voteButton.disabled = true; } // Disable if already voted
            voteButtonContainer.appendChild(voteButton);
        } else if (voteButtonContainer) {
            voteButtonContainer.style.display = 'none';
        }
    });
}

// Sets up UI for Reveal Phase (displays vote counts, highlights eliminated)
function setupRevealUI(results) {
    console.log("Setting up Reveal UI with results:", results);
    const { voteCounts = {}, eliminatedIds = [], votes = {} } = results; // Use defaults

    document.querySelectorAll('.player-card').forEach(playerCard => {
        const playerId = playerCard.dataset.playerId;
        if (!playerId) return;
        const player = currentPlayers.find(p => p.id === playerId);
        if (!player) return;

        // Display Vote Count & Voters
        const detailsElement = playerCard.querySelector('.player-details');
        if (detailsElement) {
             detailsElement.classList.remove('is-answer'); // Remove answer styling
            detailsElement.style.display = 'block';
            let revealText = `Votes: ${voteCounts[playerId] || 0}`;
            const voters = [];
            for (const voterId in votes) {
                if (votes[voterId] === playerId) {
                    const voter = currentPlayers.find(p => p.id === voterId);
                    voters.push(voter?.name || '???');
                }
            }
            if (voters.length > 0) {
                revealText += ` (from ${voters.join(', ')})`;
            }
            detailsElement.innerHTML = revealText;
        }

        // Mark Eliminated visually
        if (eliminatedIds.includes(playerId)) {
            playerCard.classList.add('eliminated-card');
            const nameEl = playerCard.querySelector('.player-name');
            if (nameEl) nameEl.innerHTML += " <span style='color:red;font-weight:bold;'>ELIMINATED!</span>";
        }
    });
}

// Handles submission from the text input area
function handleSubmit() {
    if (!gameInput || !submitButton) { console.error("Input elements missing"); return; }
    const inputValue = gameInput.value.trim();

    if (currentPhase === 'ASKING') {
        if (!inputValue) { alert("Please enter a question."); return; }
        if (inputValue.length > QUESTION_MAX_LENGTH) { alert(`Question max length is ${QUESTION_MAX_LENGTH}.`); return; }
        console.log('Submitting question:', inputValue);
        socket.emit('submit_question', inputValue);
        gameInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Sent';
    } else if (currentPhase === 'ANSWERING') {
        if (!inputValue) { alert("Please enter an answer."); return; }
        if (inputValue.length > ANSWER_MAX_LENGTH) { alert(`Answer max length is ${ANSWER_MAX_LENGTH}.`); return; }
        console.log('Submitting answer:', inputValue);
        socket.emit('submit_answer', inputValue);
        gameInput.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Sent';
    }
}

// --- Socket.IO Event Listeners ---

socket.on('connect', () => {
    console.log('Connected to server! Socket ID:', socket.id);
    isInGame = false; myPlayerId = null; currentPlayers = []; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    if (gameArea) gameArea.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (playerList) playerList.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = '';
    if (answerArea) answerArea.innerHTML = '';
    stopTimer();
    if (statusMessage) statusMessage.textContent = 'Connected! Waiting for players...';
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server. Reason:', reason);
    if (statusMessage) statusMessage.textContent = 'Disconnected. Please refresh.';
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    if (gameArea) gameArea.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    stopTimer();
});

socket.on('connect_error', (error) => {
    console.error('Connection Error:', error);
    if (statusMessage) statusMessage.textContent = 'Failed to connect to server.';
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    stopTimer();
});

socket.on('waiting_player_count', (count) => {
    if (!isInGame && statusMessage) {
        statusMessage.textContent = `Waiting for players... (${count}/3)`;
    }
});

socket.on('game_start', (initialData) => {
    console.log('Received game_start!', initialData);
    if (!initialData?.yourPlayerId || !Array.isArray(initialData.players) || typeof initialData.gameId === 'undefined') {
        console.error("Invalid game_start data received:", initialData); if (statusMessage) statusMessage.textContent = "Error starting. Refresh."; return;
    }
    isInGame = true; myPlayerId = initialData.yourPlayerId; currentPlayers = initialData.players; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    console.log("My player ID:", myPlayerId);
    if (statusMessage) statusMessage.textContent = `Game #${initialData.gameId} starting...`;
    if (gameArea) gameArea.style.display = 'block';
    if (inputArea) inputArea.style.display = 'none';
    if (answerArea) answerArea.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = '';
    renderPlayerList(currentPlayers); // Initial render
    stopTimer();
});

// Main handler for phase changes
socket.on('new_round_phase', (data) => {
    console.log('New Phase:', data?.phase, data);
    if (!data?.phase || typeof data.duration === 'undefined' || typeof data.round === 'undefined') { console.error("Invalid phase data:", data); return; }

    currentPhase = data.phase;
    hasVotedThisRound = false; // Reset vote status for the new phase
    startTimer(data.duration);

    // Reset common UI elements
    if (questionDisplay) questionDisplay.textContent = '';
    if (inputArea) inputArea.style.display = 'none';
    if (gameInput) { gameInput.disabled = false; gameInput.value = ''; }
    if (submitButton) { submitButton.disabled = false; }
    // Clear dynamic content within player cards (will be re-added by renderPlayerList or setup functions)
     if(playerList) {
        playerList.querySelectorAll('.player-details').forEach(el => { el.textContent = ''; el.style.display = 'none'; el.classList.remove('is-answer'); });
        playerList.querySelectorAll('.vote-button-container').forEach(el => { el.innerHTML = ''; el.style.display = 'none'; });
        playerList.querySelectorAll('.player-card.current-asker').forEach(el => el.classList.remove('current-asker'));
        playerList.querySelectorAll('.player-card.eliminated-card').forEach(el => el.classList.remove('eliminated-card'));
        playerList.querySelectorAll('.player-name span').forEach(el => { if(el.textContent === ' ELIMINATED!') el.remove(); }); // Remove eliminated text span
     }


    // --- Phase Specific UI Setup ---

    if (currentPhase === 'ASKING') {
        if (typeof data.askerId === 'undefined') { console.error("Missing askerId for ASKING"); return; }
        currentAskerId = data.askerId;
        const askerName = data.askerName || '???';
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: ${askerName} is asking...`;
        if (questionDisplay) questionDisplay.textContent = `Waiting for ${askerName} to ask a question...`;

        renderPlayerList(currentPlayers, {}); // Render list first to apply asker highlight correctly

        if (data.askerId === myPlayerId) { // My turn to ask
            if (inputArea && inputLabel && submitButton && gameInput) {
                inputArea.style.display = 'block';
                inputLabel.textContent = `Your turn to ask (max ${QUESTION_MAX_LENGTH} chars):`;
                submitButton.textContent = 'Submit Question';
                gameInput.placeholder = 'Type your question here...';
                gameInput.maxLength = QUESTION_MAX_LENGTH;
            }
        }

    } else if (currentPhase === 'ANSWERING') {
        if (typeof data.question === 'undefined' || typeof data.askerId === 'undefined') { console.error("Missing data for ANSWERING"); return; }
        currentAskerId = data.askerId;
        const askerName = data.askerName || '???';
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Answer the question!`;
        if (questionDisplay) questionDisplay.textContent = `Q (${askerName}): ${data.question}`;

        renderPlayerList(currentPlayers, {}); // Render list first to apply asker highlight

        if (data.askerId !== myPlayerId) { // Not the asker, show answer input
            if (inputArea && inputLabel && submitButton && gameInput) {
                inputArea.style.display = 'block';
                inputLabel.textContent = `Your answer:`;
                submitButton.textContent = 'Submit Answer';
                gameInput.placeholder = 'Type your answer here...';
                gameInput.maxLength = ANSWER_MAX_LENGTH;
            }
        } else { // Asker waits
            if (statusMessage) statusMessage.textContent = `Round ${data.round}: Waiting for answers to your question.`;
        }

    } else if (currentPhase === 'VOTING') {
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Vote to eliminate!`;
        if (questionDisplay && data.question) questionDisplay.textContent = `Q: ${data.question}`;
        // Pass answers data to render function for setup
        renderPlayerList(currentPlayers, { answers: data.answers || {} });

    } else if (currentPhase === 'REVEAL') {
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Reveal!`;
         // Update player list immediately if provided with results data
         if (data.results && Array.isArray(data.players)) {
              currentPlayers = data.players; // Update local state with eliminated status
              renderPlayerList(currentPlayers, { results: data.results });
         } else if (data.results) {
              // Fallback: results provided but not player list - less ideal
              renderPlayerList(currentPlayers, { results: data.results });
               console.warn("Reveal phase missing updated player list in payload.");
         } else {
              // No results? Just render players to clear vote buttons.
              renderPlayerList(currentPlayers, {});
               console.warn("Reveal phase missing results data!");
         }

        // Update status message AFTER rendering
        if(data.results) {
            const eliminatedNames = data.results.eliminatedNames || [];
            if (eliminatedNames.length > 0) {
                if(statusMessage) statusMessage.textContent = `Eliminated: ${eliminatedNames.join(', ')}!`;
            } else {
                 if(statusMessage) statusMessage.textContent = `Nobody was eliminated!`;
            }
        }
    }
});

socket.on('player_update', (data) => {
    if (!isInGame) return;
    console.log("Received player update:", data);
    if (data && Array.isArray(data.players)) {
        currentPlayers = data.players;
        renderPlayerList(currentPlayers, {}); // Re-render list, pass empty object for displayData
    } else {
        console.warn("Invalid player_update data received:", data);
    }
});

socket.on('game_over', (data) => {
    if (!isInGame) return;
    console.log("Received game over:", data);
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    stopTimer();
    if (inputArea) inputArea.style.display = 'none';
    if (statusMessage) statusMessage.textContent = `Game Over! ${data?.reason || ''}`;
    // Optionally add a class to the body or container to show game over state
    document.body.classList.add('game-over');
});

socket.on('action_error', (data) => {
    console.warn("Received action error from server:", data);
    if (data?.message) {
        alert(`Error: ${data.message}`);
    }
    // Re-enable input if appropriate
    if (currentPhase === 'ASKING' && myPlayerId === currentAskerId) {
        if (gameInput) gameInput.disabled = false;
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Submit Question'; }
    } else if (currentPhase === 'ANSWERING' && myPlayerId !== currentAskerId) {
        if (gameInput) gameInput.disabled = false;
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Submit Answer'; }
    }
});

socket.on('vote_accepted', () => {
    console.log("Server accepted vote.");
    hasVotedThisRound = true;
    if (statusMessage) statusMessage.textContent = "Vote cast! Waiting for others...";
    // Disable all vote buttons visually
    document.querySelectorAll('.vote-button').forEach(button => {
        button.disabled = true;
        // Optionally change style further, e.g., button.style.backgroundColor = '#ccc';
    });
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    if (submitButton) {
        submitButton.addEventListener('click', handleSubmit);
    } else { console.error("Submit button not found!"); }

    if (gameInput) {
        gameInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleSubmit();
            }
        });
    } else { console.error("Game input not found!"); }

    if (playerList) {
        playerList.addEventListener('click', (event) => {
            const voteButton = event.target.closest('.vote-button'); // Find button even if click is on text inside it
            if (voteButton && currentPhase === 'VOTING' && !hasVotedThisRound && !voteButton.disabled) {
                const votedPlayerId = voteButton.dataset.votedPlayerId;
                if (votedPlayerId) {
                    console.log(`Voting for player: ${votedPlayerId}`);
                    socket.emit('submit_vote', { votedId: votedPlayerId });
                    // Disable buttons immediately for feedback
                    document.querySelectorAll('.vote-button').forEach(btn => { btn.disabled = true; });
                }
            }
        });
    } else { console.error("Player list not found for event delegation!"); }
}

// Initial setup
setupEventListeners();
console.log("App.js loaded and listeners set up.");

// Final connection check
setTimeout(() => {
    if (!socket.connected) {
        console.error("Socket FAILED to connect after setup.");
        if (statusMessage && statusMessage.textContent.includes('Connecting')) {
            statusMessage.textContent = "Connection failed. Check server & console.";
        }
    } else {
         console.log("Socket connected successfully.");
    }
}, 2000); // Check after 2 seconds