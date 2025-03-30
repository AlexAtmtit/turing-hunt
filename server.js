// server.js
require('dotenv').config(); // Needs to be at the VERY TOP

// Imports (keep express, http, path, Server)
const express = require('express'); const http = require('http'); const path = require('path'); const { Server } = require("socket.io");
const axios = require('axios'); // Axios might be needed here if not solely in gemini_ai.js

// --- >>> Import AI module <<< ---
const aiController = require('./gemini_ai');
// --- >>> END Import <<< ---


// Init, Port, Middleware, Helpers, Constants (keep as before)
const app = express(); const server = http.createServer(app); const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
/* ... keep generateUniqueName, generateAvatarData, shuffleArray ... */
const ADJECTIVES = ["Quick", "Lazy", "Sleepy", "Noisy", "Hungry", "Clever", "Brave", "Shiny", "Happy", "Grumpy"]; const NOUNS = ["Fox", "Dog", "Cat", "Mouse", "Bear", "Lion", "Tiger", "Robot", "Alien", "Ghost"]; const usedNames = new Set(); function generateUniqueName() { let n,a=0; do { const j=ADJECTIVES[~~(Math.random()*ADJECTIVES.length)],o=NOUNS[~~(Math.random()*NOUNS.length)]; n=`${j}${o}${ ~~(Math.random()*100)}`; a++; } while(usedNames.has(n) && a<50); usedNames.add(n); return n;} const SHAPES=['circle','square','triangle']; const COLORS=['#FF6B6B', '#4ECDC4', '#45B7D1', '#FED766', '#8AEEF4', '#F8AFA6', '#F1EFA5', '#ABE9B3']; function generateAvatarData(){return{shape:SHAPES[~~(Math.random()*SHAPES.length)],color1:COLORS[~~(Math.random()*COLORS.length)],color2:COLORS[~~(Math.random()*COLORS.length)],eyeStyle:Math.random()>0.5?'dots':'lines'};} function shuffleArray(a){for(let i=a.length-1;i>0;i--){const j=~~(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}}
const MAX_PLAYERS_FOR_GAME = 3; const AI_PLAYER_COUNT = 3; const TOTAL_PLAYERS = MAX_PLAYERS_FOR_GAME + AI_PLAYER_COUNT; const ROUND_PHASE_DURATION = { ASKING: 30, ANSWERING: 30, VOTING: 30, REVEAL: 15 }; const QUESTION_MAX_LENGTH = 40; const ANSWER_MAX_LENGTH = 100;

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

// --- >>> NEW: Add timeout constants <<< ---
const FIRST_ATTEMPT_TIMEOUT = 15000; // 15 seconds for the first try
const RETRY_TIMEOUT = 10000; // 10 seconds for the retry

// --- Game Session Class ---
class GameSession {
    // Constructor, initializePlayers, getPublicPlayerData (keep as before)
    constructor(gameId, humanSockets) { /* ... */ this.id = gameId; this.roomName = `game-${gameId}`; this.players = []; this.humanSockets = humanSockets; this.aiPlayers = []; this.currentRound = 0; this.currentPhase = null; this.currentAskerId = null; this.currentQuestion = null; this.answers = new Map(); this.votes = new Map(); this.activeTimers = { phaseTimeout: null }; console.log(`Creating GameSession ${this.id}`); this.initializePlayers(); }
    initializePlayers() {
        usedNames.clear();
        const humanPlayerData = this.humanSockets.map(socket => ({
            id: socket.id,
            socket,
            isHuman: true,
            name: generateUniqueName(),
            avatarEmoji: generateEmojiAvatar(),
            status: 'active'
        }));

        const aiPlayerData = [];
        for (let i = 0; i < AI_PLAYER_COUNT; i++) {
            aiPlayerData.push({
                id: `ai-${this.id}-${i}`,
                socket: null,
                isHuman: false,
                name: generateUniqueName(),
                avatarEmoji: generateEmojiAvatar(),
                status: 'active'
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
        }));
    }

    // --- Game Loop Logic ---
    startGameLoop() { this.startNextRound(); }
    startNextRound() { /* ... keep checkGameEnd() call */ if (this.checkGameEnd()) return; this.currentRound++; this.currentAskerId = null; this.currentQuestion = null; this.answers.clear(); this.votes.clear(); this.players.forEach(p => p.hasVoted = false); console.log(`\n--- Game ${this.id}: Starting Round ${this.currentRound} ---`); this.startPhase('ASKING'); }

    // --- >>> NEW: Add AI Action Retry Helper <<< ---
    async attemptAIActionWithRetry(player, actionType, context) {
        const actionFuncMap = {
            question: aiController.getAIQuestion,
            answer: aiController.getAIAnswer,
            vote: aiController.getAIVote
        };
        const fallbackValueMap = {
            question: "What is your favorite season?",
            answer: "(AI Answer Timed Out / Error)",
            vote: null
        };

        const actionFunc = actionFuncMap[actionType];
        const fallback = fallbackValueMap[actionType];
        const playerName = player.name || player.id;

        console.log(`Game ${this.id}: AI ${playerName} attempting ${actionType} (Attempt 1)`);

        try {
            const result = await Promise.race([
                actionFunc(player, context?.question, context?.answersData),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), FIRST_ATTEMPT_TIMEOUT))
            ]);

            const resultIsError = typeof result !== 'string' || result.length < 2 || 
                                result.toLowerCase().includes("error") || 
                                result.toLowerCase().includes("blocked") || 
                                result.toLowerCase().includes("timeout");
            const resultIsVoteError = actionType === 'vote' && (result === null || resultIsError);

            if (!resultIsError && !resultIsVoteError) {
                console.log(`Game ${this.id}: AI ${playerName} ${actionType} success (Attempt 1)`);
                return result;
            }
            throw new Error('Invalid result');
        } catch (error) {
            console.warn(`Game ${this.id}: AI ${playerName} ${actionType} failed (Attempt 1). Retrying...`);
            
            try {
                const retryResult = await Promise.race([
                    actionFunc(player, context?.question, context?.answersData),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), RETRY_TIMEOUT))
                ]);

                const retryIsError = typeof retryResult !== 'string' || retryResult.length < 2 ||
                                   retryResult.toLowerCase().includes("error") ||
                                   retryResult.toLowerCase().includes("blocked") ||
                                   retryResult.toLowerCase().includes("timeout");
                const retryVoteIsError = actionType === 'vote' && (retryResult === null || retryIsError);

                if (!retryIsError && !retryVoteIsError) {
                    console.log(`Game ${this.id}: AI ${playerName} ${actionType} success (Attempt 2)`);
                    return retryResult;
                }
                throw new Error('Invalid retry result');
            } catch (retryError) {
                console.error(`Game ${this.id}: AI ${playerName} ${actionType} failed (Attempt 2). Using fallback.`);
                return fallback;
            }
        }
    }

    // --- >>> UPDATE: startPhase to use retry wrapper <<< ---
    async startPhase(phaseName) {
        this.currentPhase = phaseName; const duration = ROUND_PHASE_DURATION[phaseName]; console.log(`Game ${this.id}: Phase: ${phaseName} (${duration}s)`);
        if(this.activeTimers.phaseTimeout) { clearTimeout(this.activeTimers.phaseTimeout); this.activeTimers.phaseTimeout = null; }
        let phaseData = { round:this.currentRound, phase:phaseName, duration:duration };

        try {
            if (phaseName === 'ASKING') {
                const active = this.players.filter(p=>p.status==='active'); if(active.length<2){this.endGame("Not enough players"); return;} this.currentAskerId = active[~~(Math.random()*active.length)].id; const asker=this.players.find(p=>p.id===this.currentAskerId); phaseData.askerId = this.currentAskerId; phaseData.askerName = asker?.name || '?'; console.log(`Game ${this.id}: ${phaseData.askerName} asking.`);

                if (!asker.isHuman) {
                    const question = await this.attemptAIActionWithRetry(asker, 'question');
                    setTimeout(() => this.handlePlayerQuestion(this.currentAskerId, question), 50);
                } else {
                    this.activeTimers.phaseTimeout = setTimeout(() => this.handleAskTimeout(), duration * 1000);
                }

            } else if (phaseName === 'ANSWERING') {
                if(!this.currentQuestion) this.currentQuestion="Default Q"; phaseData.question = this.currentQuestion; phaseData.askerId = this.currentAskerId; phaseData.askerName = this.players.find(p=>p.id===this.currentAskerId)?.name||'?';

                this.players.forEach(p => {
                    if (p.status === 'active' && !p.isHuman && p.id !== this.currentAskerId) {
                        this.attemptAIActionWithRetry(p, 'answer', { question: this.currentQuestion })
                            .then(answer => this.handlePlayerAnswer(p.id, answer))
                            .catch(e => {
                                console.error(`Game ${this.id}: Critical error in answer retry logic for ${p.name}:`, e);
                                this.handlePlayerAnswer(p.id, "(AI Logic Error)");
                            });
                    }
                });
                this.activeTimers.phaseTimeout = setTimeout(()=>this.handleAnswerTimeout(), duration * 1000);

            } else if (phaseName === 'VOTING') {
                const answersPayload = {}; this.answers.forEach((ans, pid)=>{const p=this.players.find(pl=>pl.id===pid); answersPayload[pid]={name:p?.name||'?',answer:ans};}); phaseData.answers=answersPayload; phaseData.question=this.currentQuestion;

                this.players.forEach(p => {
                    if (p.status === 'active' && !p.isHuman) {
                        this.attemptAIActionWithRetry(p, 'vote', { answersData: answersPayload })
                            .then(votedId => this.handlePlayerVote(p.id, votedId))
                            .catch(e => {
                                console.error(`Game ${this.id}: Critical error in vote retry logic for ${p.name}:`, e);
                                this.handlePlayerVote(p.id, null);
                            });
                    }
                });
                this.activeTimers.phaseTimeout = setTimeout(()=>this.handleVoteTimeout(), duration * 1000);

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

            // Emit phase data AFTER potentially awaiting AI question
            io.to(this.roomName).emit('new_round_phase', phaseData);
            console.log(`Game ${this.id}: Emitted Phase: ${phaseName}`);

        } catch (error) {
             console.error(`Game ${this.id}: Error during startPhase ${phaseName}:`, error);
             // Attempt to recover or end game
             this.endGame(`Critical error during ${phaseName}`);
        }
    }

    // calculateResults, checkGameEnd (keep as before)
    calculateResults() { /* ... */ const vC={}; const act=this.players.filter(p=>p.status==='active'); act.forEach(p=>{vC[p.id]=0;}); this.votes.forEach((vId,voterId)=>{const vr=this.players.find(p=>p.id===voterId);if(vId!==null&&vC.hasOwnProperty(vId)&&vr?.status==='active'){vC[vId]++;}}); console.log(`Vote counts:`,vC); let maxV=0; for(const pId in vC){if(vC[pId]>maxV)maxV=vC[pId];} const elimIds=[],elimN=[];if(maxV>0){for(const pId in vC){if(vC[pId]===maxV){elimIds.push(pId);const p=this.players.find(pl=>pl.id===pId);if(p)elimN.push(p.name);}}} return{voteCounts:vC,eliminatedIds:elimIds,eliminatedNames:elimN}; }
    checkGameEnd() { /* ... */ const actH=this.players.filter(p=>p.status==='active'&&p.isHuman).length; const actA=this.players.filter(p=>p.status==='active'&&!p.isHuman).length; console.log(`End Check - H:${actH}, A:${actA}`); if(actA===0){this.endGame("Humans win!");return true;} if(actH===0){this.endGame("AI wins!");return true;} return false; }

    // Action Handlers (keep as before)
    handlePlayerQuestion(playerId, questionText) { /* ... */ if(this.currentPhase!=='ASKING'||playerId!==this.currentAskerId)return; if(typeof questionText!=='string'||questionText.length===0||questionText.length>QUESTION_MAX_LENGTH){const s=this.players.find(p=>p.id===playerId)?.socket;if(s)s.emit('action_error',{message:`Q len`});return;} this.currentQuestion=questionText.trim();console.log(`Q Acc: "${this.currentQuestion}"`); if(this.activeTimers.phaseTimeout)clearTimeout(this.activeTimers.phaseTimeout);this.startPhase('ANSWERING'); }
    handleAskTimeout() { /* ... */ if(this.currentPhase==='ASKING'){console.log(`Asker ${this.currentAskerId} timed out.`);this.currentQuestion="Fav color?";this.startPhase('ANSWERING');}}
    handlePlayerAnswer(playerId, answerText) { /* ... */ const p=this.players.find(pl=>pl.id===playerId);if(this.currentPhase!=='ANSWERING'||!p||p.status!=='active'||playerId===this.currentAskerId||this.answers.has(playerId))return;if(typeof answerText!=='string'||answerText.length===0||answerText.length>ANSWER_MAX_LENGTH){if(p.socket)p.socket.emit('action_error',{message:`Ans len`});return;} this.answers.set(playerId,answerText.trim());console.log(`Ans Acc from ${playerId}. Total:${this.answers.size}`);this.checkIfPhaseComplete();}
    handleAnswerTimeout() { /* ... */ if(this.currentPhase==='ANSWERING'){console.log(`Ans timeout.`);const act=this.players.filter(p=>p.status==='active');act.forEach(p=>{if(p.id!==this.currentAskerId && !this.answers.has(p.id)){console.log(`${p.name} no ans.`);this.answers.set(p.id,"(No answer)");}});this.startPhase('VOTING');}}
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
    endGame(reason) { /* ... */ console.log(`Game ${this.id}: End! ${reason}`);io.to(this.roomName).emit('game_over',{reason:reason});this.clearAllTimers();activeGames.delete(this.id);this.humanSockets.forEach(s=>{s.leave(this.roomName);delete s.gameId;});console.log(`Game ${this.id}: Cleaned.`);}
    clearAllTimers() { /* ... */ if(this.activeTimers.phaseTimeout){clearTimeout(this.activeTimers.phaseTimeout);this.activeTimers.phaseTimeout=null;}}

} // --- End GameSession Class ---

// Helpers: broadcastWaitingCount, startGame (keep as before)
function broadcastWaitingCount(){io.emit('waiting_player_count',waitingPlayers.size);}
function startGame(playerSockets){ /* ... */ const gameId=nextGameId++;if(isNaN(gameId)){console.error("FATAL: gameId");return;} const session=new GameSession(gameId,playerSockets);activeGames.set(gameId,session);console.log(`Starting Game ${gameId}`);playerSockets.forEach(s=>{s.join(session.roomName);s.gameId=gameId;});const initialData={gameId:session.id,roomName:session.roomName,players:session.getPublicPlayerData(),yourPlayerId:null};if(isNaN(session.id)){console.error("FATAL: session.id");return;}playerSockets.forEach(s=>{const personalizedData={...initialData,yourPlayerId:s.id};s.emit('game_start',personalizedData);});session.startGameLoop();console.log(`Game ${gameId} loop started.`);}

// Socket.IO Connection Logic (keep listeners setup)
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`); waitingPlayers.add(socket); broadcastWaitingCount();
    if(waitingPlayers.size>=MAX_PLAYERS_FOR_GAME){ const playersForGame=Array.from(waitingPlayers).slice(0,MAX_PLAYERS_FOR_GAME); playersForGame.forEach(s=>{waitingPlayers.delete(s);}); startGame(playersForGame); broadcastWaitingCount(); }
    // Listeners (Q, Ans, Vote)
    socket.on('submit_question', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const t=typeof data==='string'?data:data?.question; if(typeof t==='string')g.handlePlayerQuestion(socket.id,t);}}});
    socket.on('submit_answer', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const t=typeof data==='string'?data:null; if(t!==null) g.handlePlayerAnswer(socket.id,t);}}});
    socket.on('submit_vote', (data) => { if(socket.gameId){ const g=activeGames.get(socket.gameId); if(g){ const vId=data?.votedId; if(typeof vId==='string'&&vId.length>0)g.handlePlayerVote(socket.id,vId);}}});
    // Disconnect
    socket.on('disconnect', () => { console.log(`User disconnected: ${socket.id}`); if(waitingPlayers.has(socket)){waitingPlayers.delete(socket);broadcastWaitingCount();}else if(socket.gameId){const g=activeGames.get(socket.gameId);if(g){g.handleDisconnect(socket.id);}}});
});

// Start Server (keep as before)
server.listen(PORT, ()=>{console.log(`Server listening on http://localhost:${PORT}`); console.log('Waiting...');});
server.on('error', (e)=>{console.error('Server error:', e);});
console.log("Server script initialized.");