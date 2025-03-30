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

// Add a safety timeout for ASKING phase
let askingPhaseTimeout = null;

// State tracking for UI desync detection
let lastServerEvent = Date.now();
let lastUIUpdate = Date.now();
let currentAnswers = {}; // Store last known answers
let currentResults = {}; // Store last known results
let currentQuestion = null; // Store question text for recovery

// Add diagnostics variable
let gameProgressWatchdog = null;

// Better round number extraction
function getCurrentRoundNumber() {
    try {
        // Try to get from status message
        const statusText = document.querySelector('#status-message')?.textContent || '';
        const roundMatch = statusText.match(/Round (\d+)/i);
        if (roundMatch && roundMatch[1]) {
            return parseInt(roundMatch[1], 10);
        }

        // Fallback to data attribute if we stored it
        const roundAttr = document.body.getAttribute('data-current-round');
        if (roundAttr) {
            return parseInt(roundAttr, 10);
        }

        // Default to 0 if we can't find it
        return 0;
    } catch (e) {
        console.error("Error getting round number:", e);
        return 0;
    }
}

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

// Make the forceUIRefresh function more efficient
function forceUIRefresh(serverState = null) {
    try {
        console.log("🔄 Forcing UI refresh", serverState ? `with server state: ${serverState.correctPhase}` : "");
        
        // If we have server state, update our local state first
        if (serverState && serverState.correctPhase) {
            currentPhase = serverState.correctPhase;
            // Store the round in a data attribute for backup
            if (serverState.correctRound) {
                document.body.setAttribute('data-current-round', serverState.correctRound);
            }
        }
        
        // Only update the parts of the UI that need it
        
        // 1. Phase indicator - always update this
        updatePhaseIndicator(currentPhase);
        
        // 2. Question display - only if empty or if we need to
        if (questionDisplay && (!questionDisplay.textContent || serverState?.reason === 'phase_mismatch')) {
            // If we have the question cached, use it
            if (currentQuestion) {
                questionDisplay.textContent = currentQuestion;
            }
        }
        
        // 3. Player list - only rebuild if it looks wrong
        if (playerList && Array.isArray(currentPlayers)) {
            const playerElements = document.querySelectorAll('.player-card');
            
            // Only rebuild the player list if:
            // - It's empty
            // - The count doesn't match
            // - We're explicitly told to (phase_mismatch)
            if (playerElements.length === 0 || 
                playerElements.length !== currentPlayers.length ||
                serverState?.reason === 'phase_mismatch') {
                
                playerList.innerHTML = '';
                updateGameUI(currentPlayers, {
                    answers: currentAnswers || {},
                    results: currentResults || {}
                });
            }
        }
        
        // 4. Input area visibility - make sure it's correct
        if (currentPhase) {
            updateInputAreaVisibility({
                phase: currentPhase,
                askerId: currentAskerId
            });
        }
        
        console.log("🔄 Forced UI refresh completed");
        
        // Update UI update timestamp
        lastUIUpdate = Date.now();
    } catch (error) {
        console.error("Force UI refresh error:", error);
    }
}

// Add function to recover state from DOM if needed
function recoverStateFromDOM() {
    // If we have state in memory, use that
    if (currentPhase) return;
    
    // Try to recover from DOM attributes
    const phaseAttr = document.body.getAttribute('data-current-phase');
    if (phaseAttr) {
        console.log(`Recovering phase from DOM: ${phaseAttr}`);
        currentPhase = phaseAttr;
    }
    
    const roundAttr = document.body.getAttribute('data-current-round');
    if (roundAttr) {
        console.log(`Recovering round from DOM: ${roundAttr}`);
        // This is just for reporting, we don't have a currentRound variable
    }
    
    // See if we can recover the question from the DOM
    const questionElem = document.querySelector('#question-display');
    if (questionElem && questionElem.textContent) {
        console.log(`Recovering question from DOM: ${questionElem.textContent}`);
        currentQuestion = questionElem.textContent;
    }
    
    // See if we can identify the current asker from player cards
    const askerCard = document.querySelector('.player-card.current-asker');
    if (askerCard) {
        currentAskerId = askerCard.dataset.playerId;
        console.log(`Recovering asker ID from DOM: ${currentAskerId}`);
    }
}

// Add to client-side state recovery
function attemptStateRecovery() {
    debugLog('Attempting state recovery');
    
    // If we're in a game but UI seems wrong
    if (isInGame && myPlayerId) {
        // Check if phase indicator is set correctly
        const activePhaseStep = document.querySelector('.phase-step.active');
        const hasPhaseIndicator = !!activePhaseStep;
        
        // Check if player list is populated
        const hasPlayers = playerList && playerList.children.length > 0;
        
        // Check if we've been stuck in the ASKING phase for too long
        const isStuckInAsking = currentPhase === 'ASKING' && 
                              (Date.now() - lastUIUpdate > 60000); // 60 seconds
        
        // If anything looks wrong, try to recover
        if (!currentPhase || !hasPhaseIndicator || !hasPlayers || isStuckInAsking) {
            console.warn('Game state appears invalid - requesting refresh');
            
            // Get game ID from data attribute if available
            const gameId = document.body.getAttribute('data-game-id') || socket.gameId;
            
            // Request state from server
            socket.emit('game_state_request', { gameId, playerId: myPlayerId });
            
            // Force UI refresh with current state
            forceUIRefresh();
            
            // If we're stuck in ASKING phase, log a special message
            if (isStuckInAsking) {
                console.warn("Possibly stuck in ASKING phase for over 60 seconds");
                debugLog("Stuck in ASKING phase", { 
                    timeSinceLastUpdate: Date.now() - lastUIUpdate 
                });
            }
        }
    }
}

// Add diagnostics to check the game status regularly
function startGameProgressWatchdog() {
    if (gameProgressWatchdog) {
        clearInterval(gameProgressWatchdog);
    }

    let lastPhase = currentPhase;
    let stuckTime = 0;
    const STUCK_THRESHOLD = 45000; // 45 seconds in the same phase is suspicious

    gameProgressWatchdog = setInterval(() => {
        if (!isInGame) return;

        const now = Date.now();

        // Check if we're in the same phase for too long
        if (currentPhase === lastPhase) {
            stuckTime += 5000; // Interval time

            if (stuckTime >= STUCK_THRESHOLD) {
                console.warn(`Possible stuck game: Been in ${currentPhase} phase for ${stuckTime/1000}s`);
                debugLog(`Possible stuck game: Been in ${currentPhase} phase for ${stuckTime/1000}s`);

                // For ASKING phase, we have special handling
                if (currentPhase === 'ASKING') {
                    console.log("Detected possible stuck ASKING phase - requesting game state");
                    socket.emit('game_state_request', {
                        gameId: document.body.getAttribute('data-game-id') || socket.gameId,
                        playerId: myPlayerId
                    });

                    // Also emit special debug signal for ASKING phase
                    socket.emit('debug_stuck_in_asking', {
                        timeStuck: stuckTime
                    });

                    debugLog("Stuck in ASKING phase", { stuckTime });
                }

                // Reset the stuck timer after taking action
                stuckTime = 0;
            }
        } else {
            // Phase changed, reset timer
            lastPhase = currentPhase;
            stuckTime = 0;
        }
    }, 5000);
}

// Add a special debug button that's more visible
function addDebugButton() {
    const existingButton = document.querySelector('.emergency-debug-button');
    if (existingButton) return;

    const button = document.createElement('button');
    button.classList.add('emergency-debug-button');
    button.textContent = '🚨 Next Phase';
    button.style.position = 'fixed';
    button.style.bottom = '20px';
    button.style.right = '20px';
    button.style.zIndex = '9999';
    button.style.backgroundColor = '#ff0000';
    button.style.color = 'white';
    button.style.padding = '10px 15px';
    button.style.border = 'none';
    button.style.borderRadius = '5px';
    button.style.fontWeight = 'bold';
    button.style.cursor = 'pointer';
    button.style.display = 'none'; // Hidden by default

    button.addEventListener('click', () => {
        console.log('Emergency next phase button clicked');
        debugLog('Emergency next phase button clicked');
        if (currentPhase === 'ASKING') {
            socket.emit('debug_skip_question');
        } else {
            // For other phases, send a generic force next phase
            socket.emit('debug_force_next_phase');
        }
    });

    document.body.appendChild(button);

    // Show button after 30 seconds of inactivity in the same phase
    let lastPhaseChangeTime = Date.now(); // Renamed for clarity
    let phaseCheckInterval = setInterval(() => {
        const now = Date.now();
        // Only show if we are in a game and the button exists
        if (isInGame && button && document.body.contains(button)) {
            if (now - lastPhaseChangeTime > 30000) { // 30 seconds
                button.style.display = 'block';
            }
        } else {
             // If not in game or button removed, clear interval
             clearInterval(phaseCheckInterval);
        }
    }, 5000);

    // Update last phase change time whenever phase changes
    // Use socket.onAny to catch the phase change event reliably
    const phaseChangeListener = (eventName, data) => {
        if (eventName === 'new_round_phase') {
            lastPhaseChangeTime = Date.now();
            if (button) button.style.display = 'none'; // Hide button on phase change
        }
    };
    socket.onAny(phaseChangeListener);

    // Cleanup listener and interval on disconnect or game over
    const cleanupDebugButton = () => {
        if (phaseCheckInterval) clearInterval(phaseCheckInterval);
        if (button && button.parentNode) button.parentNode.removeChild(button);
        socket.offAny(phaseChangeListener); // Remove the specific listener
    };
    socket.on('disconnect', cleanupDebugButton);
    socket.on('game_over', cleanupDebugButton);
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
        if (eventName !== 'phase_ack' && eventName !== 'heartbeat' && eventName !== 'ui_state_report') { // Also avoid logging ui_state_report
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
        if (eventName !== 'heartbeat_response' && eventName !== 'check_ui_state') { // Also avoid logging check_ui_state
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
            // debugLog(`Heartbeat sent (missed: ${missedHeartbeats})`); // Reduce log noise

            Promise.race([heartbeatResponse, heartbeatTimeout])
                .then(() => {
                    // Response received
                    missedHeartbeats = 0;
                    // debugLog('Heartbeat response received'); // Reduce log noise
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

    // Add recovery check on a timer
    setInterval(attemptStateRecovery, 30000); // Check every 30 seconds

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

        // console.log(`Updating UI for phase: ${currentPhase || 'N/A'}. Players: ${players.length}`); // Reduce log noise

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

// Improve game_start handler to fully initialize the state
socket.on('game_start', (initialData) => {
    console.log('Game Start received:', initialData);
    debugLog('Game start received', initialData);

    if (!initialData?.yourPlayerId || !Array.isArray(initialData.players)) {
        console.error("Invalid game_start data");
        return;
    }

    // Set game state
    isInGame = true;
    myPlayerId = initialData.yourPlayerId;
    currentPlayers = initialData.players;

    // Clear all state variables
    currentPhase = null;
    currentAskerId = null;
    hasVotedThisRound = false;
    eliminatedPlayerRoles = {};
    currentAnswers = {};
    currentResults = {};

    // Store game ID
    if (initialData.gameId) {
        // Store in a data attribute for recovery
        document.body.setAttribute('data-game-id', initialData.gameId);
    }

    console.log("My ID:", myPlayerId);

    // Update UI elements
    if (statusMessage) statusMessage.innerHTML = `Game #${initialData.gameId} starting...`;
    if (gameArea) gameArea.style.display = 'block';
    if (inputArea) inputArea.style.display = 'none';
    if (answerArea) answerArea.innerHTML = '';
    if (questionDisplay) questionDisplay.textContent = '';
    if (rulesBox) rulesBox.style.display = 'none';

    // Update player list with a clean slate
    if (playerList) {
        playerList.innerHTML = '';
        updateGameUI(currentPlayers);
    }

    // Reset all UI state
    if (document.querySelector('.phase-step.active')) {
        document.querySelectorAll('.phase-step').forEach(el => el.classList.remove('active'));
    }

    // Reset timer
    stopTimer();

    // Start the game progress watchdog
    startGameProgressWatchdog();

    // Add emergency debug button
    addDebugButton();

    // Add "Skip Question" button for testing/debugging
    if (isInGame && gameArea) {
        // Create debug controls
        const debugControls = document.createElement('div');
        debugControls.classList.add('debug-controls');
        debugControls.style.display = 'none'; // Hide by default
        
        const skipButton = document.createElement('button');
        skipButton.textContent = "Skip Question";
        skipButton.classList.add('skip-question');
        skipButton.addEventListener('click', () => {
            if (currentPhase === 'ASKING') {
                console.log("Skipping question (debug)");
                socket.emit('debug_skip_question');
            }
        });
        
        debugControls.appendChild(skipButton);
        gameArea.appendChild(debugControls);
        
        // Add Ctrl+D shortcut to toggle debug controls
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                debugControls.style.display = 
                    debugControls.style.display === 'none' ? 'flex' : 'none';
            }
        });
    }

    // Force a UI refresh after a short delay to ensure everything is set up
    setTimeout(() => {
        forceUIRefresh();
    }, 300);
});

// Update the new_round_phase handler to store more data
socket.on('new_round_phase', (data) => {
    try {
        console.log('New Phase received:', data?.phase, data);
        debugLog('Processing new_round_phase', data);
        lastServerEvent = Date.now();
        
        // Clear any existing asking phase timeout
        if (askingPhaseTimeout) {
            clearTimeout(askingPhaseTimeout);
            askingPhaseTimeout = null;
        }
        
        if (!data?.phase || typeof data.duration === 'undefined') {
            console.error("Invalid phase data");
            debugLog("Invalid phase data received", data);
            return;
        }

        // Store previous phase for debugging
        const previousPhase = currentPhase;
        currentPhase = data.phase;
        hasVotedThisRound = false;
        
        // Store additional state for recovery
        if (data.answers) currentAnswers = data.answers; else currentAnswers = {}; // Reset if not provided
        if (data.results) currentResults = data.results; else currentResults = {}; // Reset if not provided
        if (data.question) currentQuestion = data.question;
        if (data.askerId) currentAskerId = data.askerId || null;
        if (Array.isArray(data.players)) currentPlayers = data.players; // Update player list state
        
        // Store data in DOM for recovery
        document.body.setAttribute('data-current-phase', currentPhase);
        document.body.setAttribute('data-current-round', data.round || '1');

        // Safer timer handling
        try {
            startTimer(data.duration);
        } catch (timerError) {
            console.error("Timer error:", timerError);
        }

        // Reset common UI elements (ensure safe access)
        if (questionDisplay) questionDisplay.innerHTML = '';
        if (inputArea) inputArea.style.display = 'none';
        if (gameInput) { gameInput.disabled = false; gameInput.value = ''; }
        if (submitButton) { submitButton.disabled = false; }
        if (rulesBox) rulesBox.style.display = 'none';
        if (statusMessage && statusMessage.querySelector('.waiting-dots')) {
            statusMessage.textContent = statusMessage.textContent;
        }

        // Handle reveal phase special logic (already updates eliminatedPlayerRoles)
        if (currentPhase === 'REVEAL' && data.results?.eliminatedDetails) {
            data.results.eliminatedDetails.forEach(detail => {
                if (detail?.id != null && detail.isHuman != null) {
                    eliminatedPlayerRoles[detail.id] = detail.isHuman;
                }
            });
        }

        // Use the consolidated UI update function
        updatePhaseUI(data);
        
        // Add safety timeout for ASKING phase with AI asker
        if (data.phase === 'ASKING' && data.askerId && data.askerId !== myPlayerId) {
            console.log("Setting up AI asking timeout detection");
            
            // 35 second timeout (should trigger after server's 20-second timeout)
            askingPhaseTimeout = setTimeout(() => {
                // Only do something if we're still in ASKING phase
                if (currentPhase === 'ASKING') {
                    console.warn("AI asking phase seems stuck - refreshing game state");
                    debugLog("AI asking timeout triggered");
                    
                    // Request current game state from server
                    socket.emit('game_state_request', { 
                        gameId: document.body.getAttribute('data-game-id') || socket.gameId,
                        playerId: myPlayerId
                    });
                }
            }, 35000);
        }

        // Mark last UI update time *after* UI updates are done (implicitly via setTimeout in updatePhaseUI)
        lastUIUpdate = Date.now();

        // Send acknowledgment to server
        socket.emit('phase_ack');
        
        console.log(`Phase transition complete: ${previousPhase} -> ${currentPhase}`);
    } catch (error) {
        console.error("Critical error handling phase change:", error);
        debugLog('Critical error handling phase change', { error: error.message, stack: error.stack });
        // Try to recover basic UI
        if (statusMessage) statusMessage.textContent = "UI Error - Attempting recovery...";
        forceUIRefresh(); // Attempt force refresh on critical error
        
        // Try to recover state from DOM if possible
        recoverStateFromDOM();
    }
});

// Add a function to determine if we actually need a refresh
function checkIfRefreshNeeded() {
    // Don't refresh if we're not in a game
    if (!isInGame) return false;
    
    // Check if the phase indicator matches the current phase
    const phaseIndicator = document.querySelector('.phase-step.active');
    if (!phaseIndicator) return true;
    
    // Check if the right phase is highlighted
    const indicatorClass = phaseIndicator.className;
    const phaseMatch = 
        (currentPhase === 'ASKING' && indicatorClass.includes('phase-ask')) ||
        (currentPhase === 'ANSWERING' && indicatorClass.includes('phase-answer')) ||
        (currentPhase === 'VOTING' && indicatorClass.includes('phase-vote')) ||
        (currentPhase === 'REVEAL' && indicatorClass.includes('phase-reveal'));
    
    if (!phaseMatch) return true;
    
    // Check if the player list is populated
    const playerElements = document.querySelectorAll('.player-card');
    if (playerElements.length === 0) return true;
    
    // Check if the player list length matches current players
    if (Array.isArray(currentPlayers) && playerElements.length !== currentPlayers.length) {
        return true;
    }
    
    // Everything looks ok, no refresh needed
    return false;
}

// Replace the desync detection to be less aggressive
function checkForDesync() {
    const now = Date.now();
    const timeSinceServerEvent = now - lastServerEvent;
    const timeSinceUIUpdate = now - lastUIUpdate;
    
    // Only check if we've recently received a server event (last 10 seconds)
    if (timeSinceServerEvent < 10000) {
        // If we received an event but haven't updated the UI in 5 seconds
        if (timeSinceUIUpdate > 5000) {
            // Before forcing refresh, check if we actually need one
            const needsRefresh = checkIfRefreshNeeded();
            
            if (needsRefresh) {
                console.warn("⚠️ Possible UI desync detected. Forcing refresh...");
                debugLog("Desync detected", { 
                    timeSinceServerEvent, 
                    timeSinceUIUpdate,
                    currentPhase 
                });
                forceUIRefresh();
            } else {
                // If UI looks good, just update the lastUIUpdate timestamp
                lastUIUpdate = now;
            }
        }
    }
    
    // Schedule the next check
    setTimeout(checkForDesync, 2000);
}

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
                // Update status message instead of question display for reveal outcome
                if (statusMessage) {
                    statusMessage.textContent = elimNames.length > 0
                        ? `Eliminated: ${elimNames.join(', ')}!`
                        : `Nobody eliminated!`;
                }
            }
            questionDisplay.textContent = ''; // Clear question display in reveal
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

// 2. Make UI more resilient to race conditions with phase changes
function updatePhaseUI(data) {
    // This function consolidates all UI updates for a phase change
    // to ensure they happen together

    try {
        // Execute all UI updates within a single call stack to prevent partial updates
        setTimeout(() => {
            // Update status message
            updateStatusMessage(data);

            // Update question display
            updateQuestionDisplay(data);

            // Update player list with current data
            // Use stored state for players, but potentially new answers/results from data
            updateGameUI(currentPlayers, {
                answers: currentAnswers || data.answers || {},
                results: currentResults || data.results || {}
            });

            // Update input area visibility
            updateInputAreaVisibility(data);

            // Update phase indicator
            updatePhaseIndicator(data.phase);

            debugLog('Phase UI update complete', { phase: data.phase });
            lastUIUpdate = Date.now(); // Mark update time after UI changes are applied
        }, 10); // Small delay to ensure it runs after current stack clears
    } catch (error) {
        console.error('Error in updatePhaseUI:', error);
        // Try a more basic update as fallback
        try {
            if (statusMessage) statusMessage.textContent = `Round ${data.round || '?'}: ${data.phase || '?'}`;
            if (questionDisplay) questionDisplay.textContent = data.question || '';
        } catch (e) {
            console.error('Critical UI error:', e);
        }
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

// Make the force_refresh_ui handler smarter
socket.on('force_refresh_ui', (serverState = null) => {
    console.log("Server requested UI refresh", serverState);
    debugLog("Server requested UI refresh", serverState);
    
    // If server included a reason, log it
    if (serverState?.reason) {
        console.log(`Refresh reason: ${serverState.reason}`);
    }
    
    // Check if we actually need a refresh first
    const needsRefresh = checkIfRefreshNeeded();
    
    if (needsRefresh || serverState?.reason === 'phase_mismatch') {
        forceUIRefresh(serverState);
    } else {
        console.log("Server requested refresh but UI looks good - skipping");
    }
});

// Improved ui_state_report handler
socket.on('check_ui_state', (serverState) => {
    debugLog('Server checking UI state', serverState);

    const currentRound = getCurrentRoundNumber();

    // Report our current UI state back to server with better data
    const clientState = {
        currentPhase: currentPhase || 'UNKNOWN',
        currentRound: currentRound,
        timestamp: Date.now(),
        responseTime: Date.now() - (serverState.timestamp || 0),
        // Add DOM state information
        domState: {
            phaseIndicator: document.querySelector('.phase-step.active')?.classList.toString() || 'none',
            questionVisible: !!document.querySelector('#question-display')?.textContent,
            playerCount: document.querySelectorAll('.player-card').length
        }
    };

    socket.emit('ui_state_report', clientState);

    // If our phase doesn't match the server's, force a refresh
    if (serverState.currentPhase && serverState.currentPhase !== currentPhase) {
        console.warn(`Phase mismatch detected: Client ${currentPhase} vs Server ${serverState.currentPhase}`);
        debugLog('Phase mismatch', { client: currentPhase, server: serverState.currentPhase });
        forceUIRefresh(serverState);
    }
});

// Add new handler for game state response
socket.on('game_state_response', (gameState) => {
    debugLog('Received game state from server', gameState);

    if (gameState && gameState.phase) {
        // Update our local state
        currentPhase = gameState.phase;
        if (gameState.round) document.body.setAttribute('data-current-round', gameState.round);
        if (gameState.players) currentPlayers = gameState.players;
        if (gameState.answers) currentAnswers = gameState.answers;
        if (gameState.results) currentResults = gameState.results;

        // Force refresh with this state
        forceUIRefresh();
    }
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

    // Listen for visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("Tab became visible - checking UI state");
            debugLog("Tab visibility change");
            
            // Instead of forcing a refresh immediately, check if we need one first
            const needsRefresh = checkIfRefreshNeeded();
            
            if (needsRefresh) {
                console.log("UI refresh needed after tab visibility change");
                forceUIRefresh();
            } else {
                console.log("UI state looks good after tab visibility change");
            }
        }
    });

    // Add emergency manual refresh button accessible through a key combo
    document.addEventListener('keydown', (e) => {
        // Ctrl+Alt+R for emergency refresh
        if (e.ctrlKey && e.altKey && e.key === 'r') {
            console.log("🚨 Manual UI refresh triggered");
            debugLog("Manual refresh triggered");
            forceUIRefresh();
            e.preventDefault(); // Prevent default browser refresh if possible
        }
    });

    // Start checking for desyncs after a short delay
    setTimeout(checkForDesync, 5000);
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
