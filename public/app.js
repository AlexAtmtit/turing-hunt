// app.js (Corrected Full Version)
console.log("App.js loading...");

// --- DOM Element References ---
const statusMessage = document.getElementById('status-message');
const timerDisplay = document.getElementById('timer-display');
const gameArea = document.getElementById('game-area');
const playerList = document.getElementById('player-list'); // Parent for event delegation
const questionDisplay = document.getElementById('question-display');
const answerArea = document.getElementById('answer-area'); // Still here but hidden
const inputArea = document.getElementById('input-area');
const inputLabel = document.getElementById('input-label');
const gameInput = document.getElementById('game-input');
const submitButton = document.getElementById('submit-button');
const rulesBox = document.getElementById('rules-box');

// --- Client State ---
let isInGame = false;
let myPlayerId = null;
let currentPlayers = [];
let currentPhase = null;
let currentAskerId = null;
let phaseEndTime = 0;
let timerInterval = null;
let hasVotedThisRound = false;
const QUESTION_MAX_LENGTH = 40;
const ANSWER_MAX_LENGTH = 100;

// --- Socket.IO Connection ---
const socket = io();

// --- Helper Functions ---
function updateTimerDisplay() {
    const now = Date.now();
    const endTime = typeof phaseEndTime === 'number' ? phaseEndTime : now;
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
    if (timerInterval) { clearInterval(timerInterval); }
    const durationMs = (typeof durationSeconds === 'number' && durationSeconds > 0) ? durationSeconds * 1000 : 0;
    phaseEndTime = Date.now() + durationMs;
    updateTimerDisplay();
    if (durationMs > 0) {
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (timerDisplay) { timerDisplay.textContent = ''; }
}

function renderAvatar(avatarData) {
    const safeAvatarData = avatarData || {};
    const color1 = safeAvatarData.color1 || '#cccccc';
    const color2 = safeAvatarData.color2 || '#aaaaaa';
    const shape = safeAvatarData.shape || 'square';
    const eyeStyle = safeAvatarData.eyeStyle || 'dots';
    const avatarDiv = document.createElement('div');
    avatarDiv.style.width = '40px'; avatarDiv.style.height = '40px';
    avatarDiv.style.backgroundColor = color1; avatarDiv.style.border = `3px solid ${color2}`;
    avatarDiv.style.position = 'relative'; avatarDiv.style.boxSizing = 'border-box'; avatarDiv.style.display = 'inline-block';
    if (shape === 'circle') { avatarDiv.style.borderRadius = '50%'; }
    else if (shape === 'square') { avatarDiv.style.borderRadius = '4px'; }
    else if (shape === 'triangle') {
        avatarDiv.style.width = '0px'; avatarDiv.style.height = '0px'; avatarDiv.style.backgroundColor = 'transparent';
        const tBase = 40; const tSide = tBase / 2;
        avatarDiv.style.borderLeft = `${tSide}px solid transparent`; avatarDiv.style.borderRight = `${tSide}px solid transparent`; avatarDiv.style.borderBottom = `${tBase}px solid ${color1}`;
        avatarDiv.style.borderWidth = `0 ${tSide}px ${tBase}px ${tSide}px`; avatarDiv.style.borderColor = 'transparent'; avatarDiv.style.borderBottomColor = color1;
        avatarDiv.style.backgroundColor = ''; avatarDiv.style.border = '';
    }
    if (shape !== 'triangle') {
        const eye = document.createElement('span'); eye.textContent = eyeStyle === 'dots' ? '..' : '--';
        eye.style.position = 'absolute'; eye.style.top = '8px'; eye.style.left = '50%'; eye.style.transform = 'translateX(-50%)';
        eye.style.color = color2; eye.style.fontSize = '12px'; eye.style.zIndex = '1';
        avatarDiv.appendChild(eye);
    }
    return avatarDiv;
}

function renderPlayerList(players, displayData = {}) {
    if (!playerList) { console.error("Player list element not found"); return; }
    playerList.innerHTML = '';
    if (!Array.isArray(players)) { console.error("Invalid players data for render"); return; }

    players.forEach(player => {
        if (!player || typeof player.id === 'undefined') { console.warn("Skipping invalid player data", player); return; }

        const playerCard = document.createElement('div'); playerCard.classList.add('player-card'); playerCard.dataset.playerId = player.id; playerCard.classList.remove('current-asker', 'eliminated-card');

        if (player.status !== 'active') { playerCard.classList.add('eliminated'); }
        if (player.id === myPlayerId) { playerCard.classList.add('is-me'); }
        if (player.id === currentAskerId && currentPhase !== 'REVEAL') { playerCard.classList.add('current-asker'); }

        const avatarContainer = document.createElement('div'); avatarContainer.classList.add('avatar-container'); const avatarElement = renderAvatar(player.avatarData); avatarContainer.appendChild(avatarElement);

        const nameElement = document.createElement('span'); nameElement.classList.add('player-name'); nameElement.textContent = player.name || '???'; if (player.id === myPlayerId) nameElement.textContent += " (You)";
        const thinkingSpan = document.createElement('span'); thinkingSpan.classList.add('thinking-indicator'); thinkingSpan.style.display = 'none';

        const detailsElement = document.createElement('p'); detailsElement.classList.add('player-details'); detailsElement.style.display = 'none';
        const voteButtonContainer = document.createElement('div'); voteButtonContainer.classList.add('vote-button-container'); voteButtonContainer.style.display = 'none';

        playerCard.appendChild(avatarContainer); playerCard.appendChild(nameElement); playerCard.appendChild(thinkingSpan);
        playerCard.appendChild(detailsElement); playerCard.appendChild(voteButtonContainer);
        playerList.appendChild(playerCard);
    });

    // Call phase-specific UI setup
    if (currentPhase === 'VOTING' && displayData.answers) { setupVotingUI(displayData.answers); }
    else if (currentPhase === 'REVEAL' && displayData.results) { setupRevealUI(displayData.results); }
}

function setupVotingUI(answers) {
    console.log("Setting up Voting UI with answers:", answers);
    document.querySelectorAll('.player-card').forEach(playerCard => {
        const playerId = playerCard.dataset.playerId; if (!playerId) return; const player = currentPlayers.find(p => p.id === playerId); if (!player) return;
        const detailsElement = playerCard.querySelector('.player-details'); if (detailsElement) { detailsElement.classList.add('is-answer'); if (answers[playerId]) detailsElement.textContent = `"${answers[playerId].answer}"`; else if (playerId === currentAskerId) detailsElement.textContent = `(Asker)`; else detailsElement.textContent = `(No Ans)`; detailsElement.style.display = 'block'; }
        const voteButtonContainer = playerCard.querySelector('.vote-button-container'); if (voteButtonContainer && player.status === 'active') { voteButtonContainer.innerHTML = ''; voteButtonContainer.style.display = 'block'; const voteButton = document.createElement('button'); voteButton.classList.add('vote-button'); voteButton.dataset.votedPlayerId = player.id; voteButton.textContent = `Vote`; if (hasVotedThisRound) voteButton.disabled = true; voteButtonContainer.appendChild(voteButton); } else if (voteButtonContainer) { voteButtonContainer.style.display = 'none'; }
        const thinkingSpan = playerCard.querySelector('.thinking-indicator'); if (thinkingSpan && player.status === 'active' && !hasVotedThisRound) { thinkingSpan.style.display = 'inline-block'; } // Show if active and haven't voted
    });
}

function setupRevealUI(results) {
    console.log("Setting up Reveal UI with results:", results); const { voteCounts = {}, eliminatedIds = [], votes = {} } = results;
    document.querySelectorAll('.player-card').forEach(playerCard => {
        const playerId = playerCard.dataset.playerId; if (!playerId) return; const player = currentPlayers.find(p => p.id === playerId); if (!player) return;
        const detailsElement = playerCard.querySelector('.player-details'); if (detailsElement) { detailsElement.classList.remove('is-answer'); detailsElement.style.display = 'block'; let revealText = `Votes: ${voteCounts[playerId] || 0}`; const voters = []; for (const voterId in votes) { if (votes[voterId] === playerId) { const voter = currentPlayers.find(p => p.id === voterId); voters.push(voter?.name || '???'); } } if (voters.length > 0) revealText += ` (from ${voters.join(', ')})`; detailsElement.innerHTML = revealText; }
        if (eliminatedIds.includes(playerId)) { playerCard.classList.add('eliminated-card'); const nameEl = playerCard.querySelector('.player-name'); if (nameEl) nameEl.innerHTML += " <span style='color:var(--color-status-elim);font-weight:bold;'>ELIMINATED!</span>"; }
    });
}

function handleSubmit() {
    if (!gameInput || !submitButton) { console.error("Input elements missing"); return; }
    const inputValue = gameInput.value.trim();
    if (currentPhase === 'ASKING') {
        if (!inputValue) { alert("Please enter a question."); return; }
        if (inputValue.length > QUESTION_MAX_LENGTH) { alert(`Question max length is ${QUESTION_MAX_LENGTH}.`); return; }
        console.log('Submitting question:', inputValue); socket.emit('submit_question', inputValue); gameInput.disabled = true; submitButton.disabled = true; submitButton.textContent = 'Sent'; hideMyThinkingIndicator();
    } else if (currentPhase === 'ANSWERING') {
        if (!inputValue) { alert("Please enter an answer."); return; }
        if (inputValue.length > ANSWER_MAX_LENGTH) { alert(`Answer max length is ${ANSWER_MAX_LENGTH}.`); return; }
        console.log('Submitting answer:', inputValue); socket.emit('submit_answer', inputValue); gameInput.disabled = true; submitButton.disabled = true; submitButton.textContent = 'Sent'; hideMyThinkingIndicator();
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
    console.log('Connected:', socket.id);
    isInGame = false;
    myPlayerId = null;
    currentPlayers = [];
    currentPhase = null;
    currentAskerId = null;
    hasVotedThisRound = false;
    if (gameArea) gameArea.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (playerList) playerList.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = '';
    if (answerArea) answerArea.innerHTML = '';
    stopTimer();
    if (statusMessage) statusMessage.innerHTML = 'Connected! Waiting for players...';
    if (rulesBox) rulesBox.style.display = 'block';
    document.body.classList.remove('game-over');
});
socket.on('disconnect', () => {
    console.log('Disconnected'); if (statusMessage) statusMessage.textContent = 'Disconnected.'; isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    if (gameArea) gameArea.style.display = 'none'; if (inputArea) inputArea.style.display = 'none'; stopTimer();
});
socket.on('connect_error', () => {
    console.error('Connect Error'); if (statusMessage) statusMessage.textContent = 'Connect Fail.'; isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; stopTimer();
});
socket.on('waiting_player_count', (count) => {
    if (!isInGame && statusMessage) {
        const maxPlayers = 3;
        statusMessage.innerHTML = `Waiting for Human Players (${count}/${maxPlayers})<span class="waiting-dots"><span>.</span><span>.</span><span>.</span></span><br>The game starts when 3 humans join.`;
        if (rulesBox) rulesBox.style.display = 'block';
        if (gameArea) gameArea.style.display = 'none';
    }
});
socket.on('game_start', (initialData) => {
    console.log('Game Start:', initialData); if (!initialData?.yourPlayerId || !Array.isArray(initialData.players)) return;
    isInGame = true; myPlayerId = initialData.yourPlayerId; currentPlayers = initialData.players; currentPhase = null; currentAskerId = null; hasVotedThisRound = false;
    console.log("Me:", myPlayerId); if (statusMessage) statusMessage.innerHTML = `Game #${initialData.gameId} starting...`;
    if (gameArea) gameArea.style.display = 'block'; if (inputArea) inputArea.style.display = 'none'; if (answerArea) answerArea.innerHTML = ''; if (questionDisplay) questionDisplay.textContent = '';
    if (rulesBox) rulesBox.style.display = 'none';
    renderPlayerList(currentPlayers); stopTimer();
});

socket.on('new_round_phase', (data) => {
    console.log('New Phase:', data?.phase, data); if (!data?.phase || typeof data.duration === 'undefined') return;
    currentPhase = data.phase; hasVotedThisRound = false; startTimer(data.duration);
    // Reset UI
    if (questionDisplay) questionDisplay.textContent = ''; if (inputArea) inputArea.style.display = 'none'; if (gameInput) { gameInput.disabled = false; gameInput.value = ''; } if (submitButton) { submitButton.disabled = false; }
    if (playerList) { playerList.querySelectorAll('.player-details').forEach(el => { el.textContent = ''; el.style.display = 'none'; el.classList.remove('is-answer'); }); playerList.querySelectorAll('.vote-button-container').forEach(el => { el.innerHTML = ''; el.style.display = 'none'; }); playerList.querySelectorAll('.player-card.current-asker').forEach(el => el.classList.remove('current-asker')); playerList.querySelectorAll('.player-card.eliminated-card').forEach(el => el.classList.remove('eliminated-card')); playerList.querySelectorAll('.player-name span[style*="color:red"]').forEach(el => el.remove()); playerList.querySelectorAll('.thinking-indicator').forEach(el => el.style.display = 'none'); }

    renderPlayerList(currentPlayers, {}); // Render base list first

    if (currentPhase === 'ASKING') {
        if (typeof data.askerId === 'undefined') return; currentAskerId = data.askerId; const askerName = data.askerName || '?';
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: ${askerName} asking...`; if (questionDisplay) questionDisplay.textContent = `Waiting for ${askerName}...`;
        const askerCard = playerList?.querySelector(`.player-card[data-player-id="${data.askerId}"]`); if (askerCard) { askerCard.classList.add('current-asker'); if (data.askerId !== myPlayerId) { const indicator = askerCard.querySelector('.thinking-indicator'); if (indicator) indicator.style.display = 'inline-block'; } }
        if (data.askerId === myPlayerId) { if (inputArea && inputLabel && submitButton && gameInput) { inputArea.style.display = 'block'; inputLabel.textContent = `Ask (max ${QUESTION_MAX_LENGTH}):`; submitButton.textContent = 'Submit Q'; gameInput.placeholder = 'Question...'; gameInput.maxLength = QUESTION_MAX_LENGTH; } }
    } else if (currentPhase === 'ANSWERING') {
        if (typeof data.question === 'undefined' || typeof data.askerId === 'undefined') return; currentAskerId = data.askerId; const askerName = data.askerName || '?';
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Answer!`; if (questionDisplay) questionDisplay.textContent = `Q (${askerName}): ${data.question}`;
        const askerCard = playerList?.querySelector(`.player-card[data-player-id="${data.askerId}"]`); if (askerCard) askerCard.classList.add('current-asker');
        currentPlayers.forEach(p => { if (p.status === 'active' && p.id !== currentAskerId) { const pCard = playerList?.querySelector(`.player-card[data-player-id="${p.id}"]`); if (pCard) { const indicator = pCard.querySelector('.thinking-indicator'); if (indicator) indicator.style.display = 'inline-block'; } } });
        if (data.askerId !== myPlayerId) { if (inputArea && inputLabel && submitButton && gameInput) { inputArea.style.display = 'block'; inputLabel.textContent = `Your answer:`; submitButton.textContent = 'Submit A'; gameInput.placeholder = 'Answer...'; gameInput.maxLength = ANSWER_MAX_LENGTH; } }
        else { if (statusMessage) statusMessage.textContent = `Round ${data.round}: Waiting for answers...`; }
    } else if (currentPhase === 'VOTING') {
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Vote to eliminate!`; if (questionDisplay && data.question) questionDisplay.textContent = `Q: ${data.question}`;
        setupVotingUI(data.answers || {});
    } else if (currentPhase === 'REVEAL') {
        if (statusMessage) statusMessage.textContent = `Round ${data.round}: Reveal!`;
        if (data.results && Array.isArray(data.players)) { currentPlayers = data.players; renderPlayerList(currentPlayers, { results: data.results }); }
        else if (data.results) { renderPlayerList(currentPlayers, { results: data.results }); console.warn("Reveal missing players update"); }
        else { renderPlayerList(currentPlayers, {}); console.warn("Reveal missing results"); }
        if (data.results) { const elimNames = data.results.eliminatedNames || []; if (statusMessage) statusMessage.textContent = elimNames.length > 0 ? `Eliminated: ${elimNames.join(', ')}!` : `Nobody eliminated!`; }
    }
});

socket.on('player_update', (data) => {
    if (!isInGame) return; console.log("P Update:", data); if (data?.players) { currentPlayers = data.players; renderPlayerList(currentPlayers, {}); }
});
socket.on('game_over', (data) => {
    if (!isInGame) return; console.log("Game Over:", data); isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; stopTimer();
    if (inputArea) inputArea.style.display = 'none'; if (statusMessage) statusMessage.textContent = `Game Over! ${data?.reason || ''}`; document.body.classList.add('game-over');
});
socket.on('action_error', (data) => {
    console.warn("Action Err:", data); if (data?.message) alert(`Err: ${data.message}`);
    if (currentPhase === 'ASKING' && myPlayerId === currentAskerId) { if (gameInput) gameInput.disabled = false; if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Submit Q'; } }
    else if (currentPhase === 'ANSWERING' && myPlayerId !== currentAskerId) { if (gameInput) gameInput.disabled = false; if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Submit A'; } }
});
socket.on('vote_accepted', () => {
    console.log("Vote Acc."); hasVotedThisRound = true; if (statusMessage) statusMessage.textContent = "Vote cast! Waiting..."; document.querySelectorAll('.vote-button').forEach(b => { b.disabled = true; }); hideMyThinkingIndicator();
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    if (submitButton) { submitButton.addEventListener('click', handleSubmit); }
    else { console.error("Submit btn missing"); }
    if (gameInput) { gameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }); }
    else { console.error("Input missing"); }
    if (playerList) {
        playerList.addEventListener('click', (event) => {
            const voteButton = event.target.closest('.vote-button');
            if (voteButton && currentPhase === 'VOTING' && !hasVotedThisRound && !voteButton.disabled) {
                const votedPlayerId = voteButton.dataset.votedPlayerId;
                if (votedPlayerId) {
                    console.log(`Voting for ${votedPlayerId}`); socket.emit('submit_vote', { votedId: votedPlayerId });
                    document.querySelectorAll('.vote-button').forEach(btn => { btn.disabled = true; });
                    hideMyThinkingIndicator(); // Hide indicator after voting
                }
            }
        });
    } else { console.error("PlayerList missing for vote delegation!"); }
}

// Initial setup
setupEventListeners();
console.log("App.js loaded.");
setTimeout(() => { if (!socket.connected) console.error("Socket Connect Fail!"); else console.log("Socket connected."); }, 2000);