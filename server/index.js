require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

// ============ ENVIRONMENT CHECK ============
const REDIS_URL = process.env.REDIS_URL;
const FIREBASE_CONFIG = process.env.FIREBASE_CONFIG;

if (!REDIS_URL) {
  console.warn('⚠️  WARNING: REDIS_URL not found in environment variables');
  console.warn('   Matchmaking will use in-memory storage (not persistent)');
}

if (!FIREBASE_CONFIG) {
  console.warn('⚠️  WARNING: FIREBASE_CONFIG not found in environment variables');
  console.warn('   Using client-side Firebase (limited Firestore access)');
}
// ===========================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.get('/', (req, res) => res.send('<h1>ArenaPlay eSports Brain is ONLINE ⚡</h1>'));
app.get('/health', (req, res) => res.json({ 
  status: 'OK', 
  timestamp: Date.now(),
  redis: REDIS_URL ? 'configured' : 'in-memory',
  firebase: FIREBASE_CONFIG ? 'configured' : 'client-mode'
}));

let firebaseConfig;
let useAdmin = false;

// Parse FIREBASE_CONFIG if provided
if (FIREBASE_CONFIG) {
  try {
    firebaseConfig = JSON.parse(FIREBASE_CONFIG);
    useAdmin = true;
    console.log('✅ FIREBASE_CONFIG loaded from environment (Admin mode)');
  } catch (e) {
    console.error('❌ Failed to parse FIREBASE_CONFIG:', e.message);
    useAdmin = false;
  }
}

if (!useAdmin) {
  // Fallback client config
  firebaseConfig = {
    apiKey: "AIzaSyA7xzuy71leqNpFhBopAWr4uIQO6KzPpJU",
    authDomain: "arenaplay-fc65e.firebaseapp.com",
    projectId: "arenaplay-fc65e",
    storageBucket: "arenaplay-fc65e.firebasestorage.app",
    messagingSenderId: "504507935748",
    appId: "1:504507935748:web:985ab8c0223b18ef3a9951"
  };
}

let db = null;
let firebaseInitialized = false;

try {
  const firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
  firebaseInitialized = true;
  console.log('✅ Firebase Firestore connected');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
}

// In-memory stores
const matchmakingPool = new Map();
const activeMatches = new Map();
const socketToUid = new Map();
const uidToSocket = new Map();
const ELO_THRESHOLD = 200;

async function updateUserStats(uid, isWinner, isDraw, eloChange) {
  if (!db || !firebaseInitialized) return;
  try {
    const userRef = db.doc('users/' + uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return;
    const userData = userDoc.data();
    const newWins = isWinner ? (userData.wins || 0) + 1 : userData.wins || 0;
    const newDraws = isDraw ? (userData.draws || 0) + 1 : userData.draws || 0;
    const newLosses = !isWinner && !isDraw ? (userData.losses || 0) + 1 : userData.losses || 0;
    const totalMatches = newWins + newDraws + newLosses;
    const winRate = totalMatches > 0 ? Math.round((newWins / totalMatches) * 100) : 0;
    let pointsUpdate = {};
    if (userData.division >= 4) {
      pointsUpdate = { points: (userData.points || 0) + (isWinner ? 3 : isDraw ? 1 : 0) };
    }
    let divisionUpdate = {};
    if ((userData.elo_rating || 1500) > 1600 && userData.division > 9) {
      divisionUpdate = { division: 9 };
    }
    await userRef.update({
      elo_rating: (userData.elo_rating || 1500) + eloChange,
      wins: newWins, draws: newDraws, losses: newLosses, win_rate: winRate,
      matches_played: (userData.matches_played || 0) + 1,
      matches_left: Math.max(0, (userData.matches_left || 100) - 1),
      ...pointsUpdate, ...divisionUpdate
    });
    console.log('Updated ' + uid + ': +' + eloChange + ' Elo');
  } catch (error) {
    console.error('Error updating stats:', error.message);
  }
}

setInterval(function() { findMatches(); }, 2000);

function findMatches() {
  const players = Array.from(matchmakingPool.values());
  if (players.length < 2) return;
  const matchedPairs = [];
  const matchedUIDs = new Set();
  for (let i = 0; i < players.length; i++) {
    if (matchedUIDs.has(players[i].uid)) continue;
    for (let j = i + 1; j < players.length; j++) {
      if (matchedUIDs.has(players[j].uid)) continue;
      if (Math.abs(players[i].elo - players[j].elo) <= ELO_THRESHOLD) {
        matchedPairs.push({ player1: players[i], player2: players[j] });
        matchedUIDs.add(players[i].uid);
        matchedUIDs.add(players[j].uid);
        break;
      }
    }
  }
  matchedPairs.forEach(processMatchPair);
}

function processMatchPair(pair) {
  const player1 = pair.player1;
  const player2 = pair.player2;
  matchmakingPool.delete(player1.uid);
  matchmakingPool.delete(player2.uid);

  const matchId = 'match_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const isPlayer1Host = Math.random() > 0.5;
  
  activeMatches.set(matchId, {
    matchId: matchId,
    player1: player1.uid,
    player2: player2.uid,
    hostUid: isPlayer1Host ? player1.uid : player2.uid,
    guestUid: isPlayer1Host ? player2.uid : player1.uid,
    player1SocketId: player1.socket.id,
    player2SocketId: player2.socket.id,
    scores: {},
    roomId: null,
    createdAt: Date.now()
  });

  console.log('Match found: ' + player1.uid + ' vs ' + player2.uid + ' | Host: ' + (isPlayer1Host ? player1.uid : player2.uid));

  const p1SocketId = player1.socket.id;
  const p2SocketId = player2.socket.id;
  
  const p1Role = isPlayer1Host ? 'host' : 'guest';
  const p2Role = isPlayer1Host ? 'guest' : 'host';
  
  console.log('-> Player1 (' + p1SocketId + '): role=' + p1Role);
  console.log('-> Player2 (' + p2SocketId + '): role=' + p2Role);

  io.to(p1SocketId).emit('match_found', {
    matchId: matchId,
    role: p1Role,
    opponent: { uid: player2.uid, elo: player2.elo }
  });

  io.to(p2SocketId).emit('match_found', {
    matchId: matchId,
    role: p2Role,
    opponent: { uid: player1.uid, elo: player1.elo }
  });
}

io.on('connection', function(socket) {
  const uid = socket.handshake.auth.uid || 'demo_' + Date.now();
  socket.user = { uid: uid };
  socketToUid.set(socket.id, uid);
  uidToSocket.set(uid, socket.id);
  console.log('Connected: ' + uid + ' (socket: ' + socket.id + ')');

  socket.on('find_match', function(data) {
    if (!data || !data.elo) {
      socket.emit('error', { message: 'Invalid Elo' });
      return;
    }
    matchmakingPool.set(uid, { uid: uid, elo: data.elo, socket: socket });
    console.log(uid + ' joined queue with Elo: ' + data.elo);
    socket.emit('queue_joined', { message: 'Added to queue', elo: data.elo });
  });

  socket.on('submit_room_id', function(data) {
    const matchId = data.matchId;
    const roomId = data.roomId;
    console.log('Room ID submitted: ' + roomId + ' for ' + matchId + ' by ' + uid);
    
    const match = activeMatches.get(matchId);
    if (!match) {
      socket.emit('error', { message: 'Match not found' });
      return;
    }
    if (uid !== match.hostUid) {
      socket.emit('error', { message: 'Only host can submit room ID' });
      return;
    }

    match.roomId = roomId;
    
    const guestSocketId = match.player2 === uid ? match.player1SocketId : match.player2SocketId;
    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) {
      console.log('Sending receive_room_id to guest socket: ' + guestSocketId);
      guestSocket.emit('receive_room_id', { roomId: roomId, matchId: matchId });
    } else {
      console.log('Guest socket not found: ' + guestSocketId);
    }
    
    socket.emit('room_id_confirmed', { roomId: roomId, matchId: matchId });
    console.log('Room ID confirmed for host ' + uid);
  });

  socket.on('submit_score', async function(data) {
    const matchId = data.matchId;
    const playerScore = data.playerScore;
    const opponentScore = data.opponentScore;
    const screenshotUrl = data.screenshotUrl;
    const isWinner = data.isWinner;
    const isDraw = data.isDraw;
    console.log('Score: ' + uid + ' submitted ' + playerScore + '-' + opponentScore);
    
    const match = activeMatches.get(matchId);
    if (!match) {
      socket.emit('error', { message: 'Match not found' });
      return;
    }
    
    match.scores[uid] = { 
      playerScore: playerScore, 
      opponentScore: opponentScore, 
      screenshotUrl: screenshotUrl, 
      isWinner: isWinner, 
      isDraw: isDraw, 
      submittedAt: Date.now() 
    };
    
    const player1Id = match.player1;
    const player2Id = match.player2;
    
    if (match.scores[player1Id] && match.scores[player2Id]) {
      const score1 = match.scores[player1Id];
      const score2 = match.scores[player2Id];
      const scoresMatch = score1.playerScore === score2.opponentScore && score2.playerScore === score1.opponentScore;
      
      if (scoresMatch) {
        console.log('Match ' + matchId + ' APPROVED');
        const winnerUid = score1.isWinner ? player1Id : player2Id;
        const loserUid = score1.isWinner ? player2Id : player1Id;
        await updateUserStats(winnerUid, true, false, 25);
        await updateUserStats(loserUid, false, false, -15);
        
        const p1Socket = io.sockets.sockets.get(match.player1SocketId);
        const p2Socket = io.sockets.sockets.get(match.player2SocketId);
        if (p1Socket) p1Socket.emit('score_submitted', { approved: true, matchId: matchId });
        if (p2Socket) p2Socket.emit('score_submitted', { approved: true, matchId: matchId });
        
        activeMatches.delete(matchId);
      } else {
        console.log('Match ' + matchId + ' DISPUTED');
        const p1Socket = io.sockets.sockets.get(match.player1SocketId);
        const p2Socket = io.sockets.sockets.get(match.player2SocketId);
        if (p1Socket) p1Socket.emit('score_submitted', { disputed: true, matchId: matchId });
        if (p2Socket) p2Socket.emit('score_submitted', { disputed: true, matchId: matchId });
      }
    } else {
      socket.emit('score_submitted', { pending: true, matchId: matchId });
    }
  });

  socket.on('leave_match', function() {
    matchmakingPool.delete(uid);
    console.log(uid + ' left queue');
  });

  socket.on('cancel_match', function() {
    matchmakingPool.delete(uid);
    socket.emit('queue_left');
  });

  socket.on('disconnect', function(reason) {
    console.log('Disconnected: ' + uid + ' (' + reason + ')');
    socketToUid.delete(socket.id);
    uidToSocket.delete(uid);
    matchmakingPool.delete(uid);
    
    for (const [matchId, match] of activeMatches.entries()) {
      if (match.player1 === uid || match.player2 === uid) {
        const otherUid = match.player1 === uid ? match.player2 : match.player1;
        const otherSocketId = otherUid === match.player1 ? match.player1SocketId : match.player2SocketId;
        const otherSocket = io.sockets.sockets.get(otherSocketId);
        if (otherSocket) otherSocket.emit('opponent_disconnected', { matchId: matchId });
        activeMatches.delete(matchId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', function() {
  console.log('ArenaPlay Server running on port ' + PORT);
});

process.on('SIGTERM', function() { console.log('Shutting down...'); process.exit(0); });
process.on('SIGINT', function() { console.log('Shutting down...'); process.exit(0); });
