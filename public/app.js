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


// --- New Fix Functions ---

// Fix 1: Update phase indicator visual state
function updatePhaseIndicator(phase) {
    const phaseIndicator = document.getElementById('phase-indicator');
    if (!phaseIndicator) return;

    // Remove all active classes
    const phases = ['phase-ask', 'phase-answer', 'phase-vote', 'phase-reveal'];
    phases.forEach(p => {
        const elem = phaseIndicator.querySelector(`.${p}`);
        if (elem) elem.classList.remove('active');
    });

    // Add active class to current phase
    let activeClass = '';
    if (phase === 'ASKING') activeClass = 'phase-ask';
    else if (phase === 'ANSWERING') activeClass = 'phase-answer';
    else if (phase === 'VOTING') activeClass = 'phase-vote';
    else if (phase === 'REVEAL') activeClass = 'phase-reveal';

    if (activeClass) {
        const activeElem = phaseIndicator.querySelector(`.${activeClass}`);
        if (activeElem) activeElem.classList.add('active');
    }

    // Add a class to the body for global phase styling
    document.body.className = ''; // Clear previous phase classes
    if (phase) document.body.classList.add(`phase-${phase.toLowerCase()}`);

    // Add transition animation
    phaseIndicator.classList.add('phase-transition');
    setTimeout(() => phaseIndicator.classList.remove('phase-transition'), 500);
}

// Fix 2: Update connection status UI
function updateConnectionStatus(isConnected) {
    const connStatus = document.getElementById('connection-status');
    if (!connStatus) return;

    if (isConnected) {
        connStatus.classList.remove('disconnected');
        connStatus.querySelector('.connection-text').textContent = 'Connected';
        // Hide refresh button if it was shown
        const refreshBtn = document.getElementById('force-refresh');
        if (refreshBtn) refreshBtn.style.display = 'none';
    } else {
        connStatus.classList.add('disconnected');
        connStatus.querySelector('.connection-text').textContent = 'Disconnected';

        // Show emergency refresh button after short delay if still disconnected
        setTimeout(() => {
            // Check connection status *again* inside the timeout
            if (!socket.connected) {
                const refreshBtn = document.getElementById('force-refresh');
                if (refreshBtn) refreshBtn.style.display = 'block';
            }
        }, 3000);
    }
}

// Fix 3: Add debug logging functionality
let debugLogs = [];
const MAX_DEBUG_LOGS = 50;

function debugLog(message, data = null) {
    const timestamp = new Date().toISOString().substr(11, 8); // HH:MM:SS
    const logEntry = {
        time: timestamp,
        message: message,
        data: data
    };

    // Add to beginning of array for newest-first
    debugLogs.unshift(logEntry);

    // Trim to maximum length
    if (debugLogs.length > MAX_DEBUG_LOGS) {
        debugLogs = debugLogs.slice(0, MAX_DEBUG_LOGS);
    }

    // Update debug panel if visible
    updateDebugPanel();
    console.log(`[DEBUG] ${timestamp} ${message}`, data || '');
}

function updateDebugPanel() {
    const debugContent = document.getElementById('debug-content');
    const debugPanel = document.getElementById('debug-panel');
    // Only update if the panel exists AND is visible
    if (!debugContent || !debugPanel || debugPanel.style.display === 'none') return;

    let html = '';
    // Iterate in reverse to show oldest first in the panel
    for (let i = debugLogs.length - 1; i >= 0; i--) {
        const log = debugLogs[i];
        html += `<div>[${log.time}] ${log.message}</div>`;
        if (log.data) {
            try {
                // Attempt to stringify, handle potential circular references or errors
                html += `<div class="debug-data">${JSON.stringify(log.data)}</div>`;
            } catch (e) {
                html += `<div class="debug-data">[Error stringifying data]</div>`;
            }
        }
    }

    debugContent.innerHTML = html;
    // Scroll to bottom
    debugContent.scrollTop = debugContent.scrollHeight;
}

// Fix 4: Toggle debug panel visibility
function setupDebugPanel() {
    const toggleBtn = document.getElementById('toggle-debug');
    const debugPanel = document.getElementById('debug-panel');

    if (!toggleBtn || !debugPanel) {
        console.warn("Debug panel elements not found.");
        return;
    }

    // Initial state based on CSS (assuming it starts hidden)
    debugPanel.style.display = 'none';
    toggleBtn.textContent = 'Show Debug';

    // Add Shift+D keyboard shortcut to toggle debug panel
    document.addEventListener('keydown', (e) => {
        // Avoid triggering in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.shiftKey && e.key === 'D') {
            const isHidden = debugPanel.style.display === 'none';
            debugPanel.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? 'Hide Debug' : 'Show Debug';
            if (isHidden) updateDebugPanel(); // Update content only when showing
        }
    });

    // Button click handler
    toggleBtn.addEventListener('click', () => {
        const isHidden = debugPanel.style.display === 'none';
        debugPanel.style.display = isHidden ? 'block' : 'none';
        toggleBtn.textContent = isHidden ? 'Hide Debug' : 'Show Debug';
        if (isHidden) updateDebugPanel(); // Update content only when showing
    });
}

// Fix 5: Setup emergency refresh button
function setupEmergencyRefresh() {
    const refreshBtn = document.getElementById('force-refresh');
    if (!refreshBtn) {
        console.warn("Emergency refresh button not found.");
        return;
    }

    // Hide initially
    refreshBtn.style.display = 'none';

    refreshBtn.addEventListener('click', () => {
        debugLog('Emergency refresh requested');
        window.location.reload();
    });
}

// Fix 6: Add enhanced socket event logging
function enhanceSocketLogging() {
    // Save original emit to add logging
    const originalEmit = socket.emit;
    socket.emit = function(eventName, ...args) {
        // Don't log phase_ack or heartbeat to avoid spam
        if (eventName !== 'phase_ack' && eventName !== 'heartbeat') {
            // Clone args[0] if it's an object to avoid logging mutations
            const dataArg = (typeof args[0] === 'object' && args[0] !== null) ? JSON.parse(JSON.stringify(args[0])) : args[0];
            debugLog(`Emit: ${eventName}`, dataArg);
        }
        return originalEmit.apply(this, [eventName, ...args]);
    };

    // Enhance connection events
    socket.on('connect', () => {
        debugLog('Socket connected');
        updateConnectionStatus(true);
    });

    socket.on('disconnect', (reason) => {
        debugLog('Socket disconnected', { reason });
        updateConnectionStatus(false);
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
        debugLog('Reconnect attempt', { attempt: attemptNumber });
    });

    // Log all incoming events (except heartbeat response)
    socket.onAny((eventName, ...args) => {
        if (eventName !== 'heartbeat_response') {
             const dataArg = (typeof args[0] === 'object' && args[0] !== null) ? JSON.parse(JSON.stringify(args[0])) : args[0];
            debugLog(`Recv: ${eventName}`, dataArg);
        }
    });
}

// Fix 7: Add periodic client-server heartbeat to detect stalled connections
function setupHeartbeat() {
    let heartbeatInterval = null;
    let missedHeartbeats = 0;
    const MAX_MISSED_HEARTBEATS = 3;
    const HEARTBEAT_INTERVAL_MS = 15000; // 15 seconds

    socket.on('connect', () => {
        // Start heartbeat when connected
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        missedHeartbeats = 0; // Reset on connect/reconnect

        heartbeatInterval = setInterval(() => {
            if (!socket.connected) {
                // Should not happen if disconnect event clears interval, but safety check
                missedHeartbeats = 0;
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
                return;
            }

            // Use a Promise to handle the response or timeout
            const heartbeatTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Heartbeat timeout')), 5000) // 5 second timeout for response
            );

            const heartbeatResponse = new Promise((resolve) => {
                socket.once('heartbeat_response', resolve);
            });

            socket.emit('heartbeat');
            missedHeartbeats++;
            debugLog(`Heartbeat sent (missed: ${missedHeartbeats})`);

            Promise.race([heartbeatResponse, heartbeatTimeout])
                .then(() => {
                    // Response received
                    missedHeartbeats = 0;
                    debugLog('Heartbeat response received');
                })
                .catch((error) => {
                    // Timeout or other error
                    debugLog(`Heartbeat issue: ${error.message} (missed: ${missedHeartbeats})`);
                    if (missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
                        debugLog('Max missed heartbeats reached - connection likely stalled. Forcing reconnect.');
                        // Force reconnection
                        socket.disconnect().connect();
                        missedHeartbeats = 0; // Reset after forcing reconnect
                        // No need to clear interval here, disconnect event will handle it
                    }
                });

        }, HEARTBEAT_INTERVAL_MS);
    });

    // No need for explicit heartbeat_response handler here, it's handled in the Promise

    socket.on('disconnect', () => {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            debugLog('Heartbeat stopped due to disconnect.');
        }
        missedHeartbeats = 0; // Reset on disconnect
    });
}

// Fix 8: Call all setup functions when DOM is ready
function setupAllFixedFunctionality() {
    setupDebugPanel();
    setupEmergencyRefresh();
    enhanceSocketLogging(); // This now handles connect/disconnect logging and status updates
    setupHeartbeat();

    // Initialize connection status UI based on current state
    // updateConnectionStatus is called by enhanceSocketLogging on connect/disconnect
    // but call it once initially in case socket connects before enhanceSocketLogging runs
    updateConnectionStatus(socket.connected);

    debugLog('Enhanced functionality initialized');
}

// --- End New Fix Functions ---

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

// Fix 3: Improve the updateGameUI function with better error handling
function updateGameUI(players, displayData = {}) {
    try {
        if (!playerList) {
            console.error("Player list element not found for update");
            return;
        }
        
        // Don't clear player list if invalid data received
        if (!Array.isArray(players)) {
            console.error("Invalid players data for update");
            return;
        }
        
        // Clear with a try/catch
        try {
            playerList.innerHTML = '';
        } catch (clearError) {
            console.error("Error clearing player list:", clearError);
            return;
        }

        console.log(`Updating UI for phase: ${currentPhase || 'N/A'}. Players: ${players.length}`);

        // Process each player in try/catch to avoid one broken player affecting others
        players.forEach(player => {
            try {
                if (!player || typeof player.id === 'undefined') {
                    console.warn("Skipping invalid player data", player);
                    return;
                }
                
                // Create player card
                const playerCard = createPlayerCard(player, displayData);
                playerList.appendChild(playerCard);
            } catch (playerError) {
                console.error(`Error creating player card for ${player?.id}:`, playerError);
                // Continue with next player
            }
        });
    } catch (error) {
        console.error("Critical error in updateGameUI:", error);
    }
}

// Fix 4: Separate player card creation into its own function
function createPlayerCard(player, displayData = {}) {
    const playerCard = document.createElement('div');
    playerCard.classList.add('player-card');
    playerCard.dataset.playerId = player.id;
    
    // Base status classes
    if (player.status !== 'active') {
        playerCard.classList.add('eliminated');
    }
    if (player.id === myPlayerId) {
        playerCard.classList.add('is-me');
    }
    if (player.id === currentAskerId) {
        playerCard.classList.add('current-asker');
    }

    // Create and append elements safely with try/catch
    try {
        // Avatar
        const avatarContainer = document.createElement('div');
        avatarContainer.classList.add('avatar-container');
        const avatarElement = document.createElement('span');
        avatarElement.textContent = player.avatarEmoji || '❓';
        avatarContainer.appendChild(avatarElement);
        playerCard.appendChild(avatarContainer);
        
        // Name
        const nameElement = document.createElement('span');
        nameElement.classList.add('player-name');
        nameElement.textContent = player.name || '???';
        if (player.id === myPlayerId) nameElement.textContent += " (You)";
        playerCard.appendChild(nameElement);
        
        // Role label
        const roleLabelElement = document.createElement('span');
        roleLabelElement.classList.add('player-role-label');
        roleLabelElement.style.display = 'none';
        playerCard.appendChild(roleLabelElement);
        
        // Thinking indicator
        const thinkingSpan = document.createElement('span');
        thinkingSpan.classList.add('thinking-indicator');
        thinkingSpan.style.display = 'none';
        playerCard.appendChild(thinkingSpan);
        
        // Details
        const detailsElement = document.createElement('p');
        detailsElement.classList.add('player-details');
        detailsElement.style.display = 'none';
        playerCard.appendChild(detailsElement);
        
        // Vote buttons
        const voteButtonContainer = document.createElement('div');
        voteButtonContainer.classList.add('vote-button-container');
        voteButtonContainer.style.display = 'none';
        playerCard.appendChild(voteButtonContainer);
        
        // Show role if eliminated
        if (player.status !== 'active' && eliminatedPlayerRoles.hasOwnProperty(player.id)) {
            const isHuman = eliminatedPlayerRoles[player.id];
            roleLabelElement.textContent = isHuman ? '❌Human' : '😅AI';
            roleLabelElement.style.display = 'block';
        }
        
        // Phase-specific UI updates
        updatePlayerCardForPhase(player, playerCard, displayData);
        
    } catch (error) {
        console.error(`Error building player card for ${player.id}:`, error);
        // Return basic player card even if there's an error
        playerCard.textContent = player.name || "Player";
    }
    
    return playerCard;
}

// Fix 5: Separate phase-specific player card updates into a function
function updatePlayerCardForPhase(player, playerCard, displayData = {}) {
    try {
        const thinkingSpan = playerCard.querySelector('.thinking-indicator');
        const detailsElement = playerCard.querySelector('.player-details');
        const voteButtonContainer = playerCard.querySelector('.vote-button-container');
        const roleLabelElement = playerCard.querySelector('.player-role-label');
        
        // REVEAL phase
        if (currentPhase === 'REVEAL') {
            if (detailsElement) {
                const results = displayData.results || {};
                const voteCount = results.voteCounts?.[player.id] || 0;
                detailsElement.textContent = `Votes: ${voteCount}`;
                detailsElement.style.display = 'block';
            }
            
            // Highlight if eliminated this round
            const eliminatedInfo = displayData.results?.eliminatedDetails?.find(e => e.id === player.id);
            if (eliminatedInfo) {
                playerCard.classList.add('eliminated-card');
                if (roleLabelElement) {
                    roleLabelElement.textContent = eliminatedInfo.isHuman ? '❌Human' : '😅AI';
                    roleLabelElement.style.display = 'block';
                }
            }
        }
        // VOTING phase
        else if (currentPhase === 'VOTING') {
            if (detailsElement) {
                detailsElement.classList.add('is-answer');
                const answerInfo = displayData.answers?.[player.id];
                if (answerInfo) {
                    detailsElement.textContent = `"${answerInfo.answer}"`;
                } else if (player.id === currentAskerId) {
                    detailsElement.textContent = `(Asker)`;
                } else {
                    detailsElement.textContent = `(No Ans)`;
                }
                detailsElement.style.display = 'block';
            }
            
            if (player.status === 'active' && voteButtonContainer) {
                voteButtonContainer.innerHTML = '';
                voteButtonContainer.style.display = 'block';
                
                const voteButton = document.createElement('button');
                voteButton.classList.add('vote-button');
                voteButton.dataset.votedPlayerId = player.id;
                voteButton.textContent = `That's AI!`;
                voteButton.disabled = hasVotedThisRound || player.id === myPlayerId;
                voteButtonContainer.appendChild(voteButton);
                
                if (thinkingSpan && !hasVotedThisRound && player.id !== myPlayerId) {
                    thinkingSpan.style.display = 'inline-block';
                }
            }
        }
        // ASKING phase
        else if (currentPhase === 'ASKING' && player.id === currentAskerId && player.id !== myPlayerId) {
            if (thinkingSpan) thinkingSpan.style.display = 'inline-block';
        }
        // ANSWERING phase
        else if (currentPhase === 'ANSWERING' && player.status === 'active' && player.id !== currentAskerId) {
            if (thinkingSpan) thinkingSpan.style.display = 'inline-block';
        }
    } catch (error) {
        console.error(`Error updating player card phase UI for ${player.id}:`, error);
    }
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
// Note: 'connect' and 'disconnect' handlers are now enhanced by enhanceSocketLogging()
// We still need the game state reset logic here.

socket.on('connect', () => {
    // debugLog and updateConnectionStatus are handled by enhanceSocketLogging
    console.log('Socket connected event fired. ID:', socket.id); // Keep basic console log
    isInGame = false; myPlayerId = null; currentPlayers = []; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    // Safely update UI elements
    if (gameArea) gameArea.style.display = 'none'; if (inputArea) inputArea.style.display = 'none'; if (playerList) playerList.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = ''; if (answerArea) answerArea.innerHTML = ''; stopTimer();
    if (statusMessage) statusMessage.innerHTML = 'Connected! Waiting...'; // Clear any previous dots
    if (rulesBox) rulesBox.style.display = 'block';
    document.body.classList.remove('game-over');
    // Initial phase indicator state (optional, could be set by first phase event)
    updatePhaseIndicator(null);
});

socket.on('disconnect', (reason) => {
    // debugLog and updateConnectionStatus are handled by enhanceSocketLogging
    console.log('Socket disconnect event fired:', reason); // Keep basic console log
    if (statusMessage) statusMessage.innerHTML = 'Disconnected. Trying to reconnect...'; // Updated message
    isInGame = false; currentPhase = null; currentAskerId = null; hasVotedThisRound = false; eliminatedPlayerRoles = {};
    if (gameArea) gameArea.style.display = 'none'; if (inputArea) inputArea.style.display = 'none'; if (rulesBox) rulesBox.style.display = 'none';
    stopTimer();
    // Clear phase indicator on disconnect
    updatePhaseIndicator(null);
});

// Note: 'reconnect_attempt' is handled by enhanceSocketLogging

socket.on('connect_error', (error) => {
    debugLog('Socket Connection Error', { error: error.message }); // Use debugLog
    console.error('Socket Connection Error:', error); // Keep console error
    if (statusMessage) statusMessage.innerHTML = 'Connection Failed.';
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
    // Note: debugLog for receiving this event is handled by enhanceSocketLogging's socket.onAny

    try {
        // Add specific debug log for phase details *before* processing
        debugLog('Processing new_round_phase', { phase: data?.phase, round: data?.round, askerId: data?.askerId });

        // Original console log can be kept or removed depending on preference
        // console.log('New Phase received:', data?.phase, data);

        if (!data?.phase || typeof data.duration === 'undefined') {
            debugLog("Invalid phase data received", data); // Log invalid data
            console.error("Invalid phase data");
            return;
        }

        // Store previous phase for debugging
        const previousPhase = currentPhase;
        currentPhase = data.phase;
        hasVotedThisRound = false;
        
        // Safer timer handling
        try {
            startTimer(data.duration);
        } catch (timerError) {
            console.error("Timer error:", timerError);
            // Continue despite timer errors
        }
        
        currentAskerId = data.askerId || null;

        // Reset common UI elements (ensure safe access)
        if (questionDisplay) questionDisplay.innerHTML = '';
        if (inputArea) inputArea.style.display = 'none';
        if (gameInput) { gameInput.disabled = false; gameInput.value = ''; }
        if (submitButton) { submitButton.disabled = false; }
        if (rulesBox) rulesBox.style.display = 'none';
        if (statusMessage && statusMessage.querySelector('.waiting-dots')) {
            statusMessage.textContent = statusMessage.textContent;
        }

        // Update status message first
        updateStatusMessage(data);
        
        // Update question display
        updateQuestionDisplay(data);
        
        // Handle reveal phase special logic
        if (currentPhase === 'REVEAL' && data.results?.eliminatedDetails) {
            data.results.eliminatedDetails.forEach(detail => {
                if (detail?.id != null && detail.isHuman != null) {
                    eliminatedPlayerRoles[detail.id] = detail.isHuman;
                }
            });
            
            if (Array.isArray(data.players)) {
                currentPlayers = data.players;
            }
        }

        // Update UI with current players and phase data
        try {
            updateGameUI(currentPlayers, {
                answers: data.answers,
                results: data.results
            });
        } catch (uiError) {
            console.error("Error updating game UI:", uiError);
            // Try again with minimal data
            try {
                updateGameUI(currentPlayers, {});
            } catch (retryError) {
                console.error("Critical UI update failure:", retryError);
            }
        }

        // Show/hide input area based on phase
        updateInputAreaVisibility(data);
        
        // Send acknowledgment to server
        socket.emit('phase_ack');
        
        // Add call to update phase indicator visual state
        updatePhaseIndicator(currentPhase);

        console.log(`Phase transition complete: ${previousPhase} -> ${currentPhase}`);

    } catch (error) {
        // Use debugLog for the error
        debugLog('Critical error handling phase change', { error: error.message, stack: error.stack });
        console.error("Critical error handling phase change:", error); // Keep console error
        // Try to recover basic UI
        if (statusMessage) statusMessage.textContent = "UI Error - Please refresh";
    }
});

// Fix 2: Break down the phase handler into smaller functions
function updateStatusMessage(data) {
    try {
        if (!statusMessage) return;
        
        let statusText = `Round ${data.round || '?'}: `;
        if (currentPhase === 'ASKING') {
            statusText += `${data.askerName || '?'} is asking<span class="waiting-dots"></span>`;
        }
        else if (currentPhase === 'ANSWERING') statusText += `Answer!`;
        else if (currentPhase === 'VOTING') statusText += `Vote!`;
        else if (currentPhase === 'REVEAL') statusText += `Reveal!`;
        else statusText += currentPhase;
        
        statusMessage.innerHTML = statusText;
    } catch (error) {
        console.error("Error updating status message:", error);
    }
}

function updateQuestionDisplay(data) {
    try {
        if (!questionDisplay) return;
        
        if (currentPhase === 'ASKING') {
            questionDisplay.innerHTML = `Waiting for ${data.askerName || '?'}<span class="waiting-dots"></span>`;
        }
        else if (currentPhase === 'ANSWERING' || currentPhase === 'VOTING') {
            questionDisplay.textContent = `Q (${data.askerName || '?'}): ${data.question || '...'}`;
        }
        else if (currentPhase === 'REVEAL') {
            if (data.results) {
                const elimDetails = data.results.eliminatedDetails || [];
                const elimNames = elimDetails.map(e => e.name);
                if (statusMessage) {
                    statusMessage.textContent = elimNames.length > 0 
                        ? `Eliminated: ${elimNames.join(', ')}!` 
                        : `Nobody eliminated!`;
                }
            }
        } else {
            questionDisplay.textContent = '';
        }
    } catch (error) {
        console.error("Error updating question display:", error);
    }
}

function updateInputAreaVisibility(data) {
    try {
        if (!inputArea) return;
        
        if (currentPhase === 'ASKING' && data.askerId === myPlayerId) {
            if (inputLabel) inputLabel.textContent = `Ask (max ${QUESTION_MAX_LENGTH}):`;
            if (submitButton) submitButton.textContent = 'Submit Q';
            if (gameInput) {
                gameInput.placeholder = 'Question...';
                gameInput.maxLength = QUESTION_MAX_LENGTH;
            }
            inputArea.style.display = 'block';
        } else if (currentPhase === 'ANSWERING' && data.askerId !== myPlayerId) {
            if (inputLabel) inputLabel.textContent = `Your answer:`;
            if (submitButton) submitButton.textContent = 'Submit A';
            if (gameInput) {
                gameInput.placeholder = 'Answer...';
                gameInput.maxLength = ANSWER_MAX_LENGTH;
            }
            inputArea.style.display = 'block';
        } else {
            inputArea.style.display = 'none';
        }
    } catch (error) {
        console.error("Error updating input area:", error);
    }
}


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

// Fix 6: Add a connectivity debug function
function checkSocketStatus() {
    const statusText = socket.connected ? "Connected" : "Disconnected";
    console.log(`Socket status check: ${statusText}`);
    
    if (!socket.connected) {
        console.warn("Socket disconnected - attempting reconnect");
        // Socket.IO should auto-reconnect, but we could add additional logic here
    }
    
    return socket.connected;
}

// Removed old checkSocketStatus interval - replaced by heartbeat
// Removed old socket.on('reconnect') - handled by connect event and enhanceSocketLogging
// Removed old socket.onAny - replaced by enhanceSocketLogging
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
     document.addEventListener('DOMContentLoaded', () => {
         setupEventListeners();
         setupAllFixedFunctionality(); // Call the new setup function
     });
} else {
     setupEventListeners(); // DOM already loaded
     setupAllFixedFunctionality(); // Call the new setup function
}
console.log("App.js loaded.");
// Removed old setTimeout connection check - handled by updateConnectionStatus and heartbeat
