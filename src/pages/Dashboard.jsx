import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '../context/FirebaseContext';
import { io } from 'socket.io-client';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Railway Production Backend - Secure WebSocket
const SERVER_IP = 'https://arenaplay-production.up.railway.app';

const socket = io(SERVER_IP, {
  // you can remove `path` if you didn't change it on the server
  // path: '/socket.io',
  transports: ['websocket', 'polling']
});

socket.on('connect_error', (err) => {
  console.log('connect_error:', err.message);
});


const Dashboard = ({ appState, setAppState }) => {
  const { userProfile, user, divisionThresholds } = useFirebase();
  const [queueTime, setQueueTime] = useState(0);
  const [matchData, setMatchData] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [playerRole, setPlayerRole] = useState(null);
  const [waitingForRoomId, setWaitingForRoomId] = useState(false);
  const [showResultUpload, setShowResultUpload] = useState(false);
  const [playerScore, setPlayerScore] = useState('');
  const [opponentScore, setOpponentScore] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [disputeWarning, setDisputeWarning] = useState(false);
  const [hostTimeout, setHostTimeout] = useState(false);
  
  const socketRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    console.log('Connecting to:', SERVER_IP);
    
    const socket = io(SERVER_IP, {
      transports: ['websocket'],
      secure: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    
    socket.on('connect', () => console.log('Socket Connected:', socket.id));
    socket.on('disconnect', () => console.log('Socket Disconnected'));
    
    socket.on('match_found', (data) => {
      console.log('🎯 Match Found:', data);
      setMatchData(data);
      setPlayerRole(data.role);
      
      if (data.role === 'host') {
        setAppState('HOST_WAITING_ROOM_ID');
      } else {
        setAppState('GUEST_WAITING_ROOM_ID');
        setWaitingForRoomId(true);
        setHostTimeout(false);
        
        // 60 second timeout for guest
        timeoutRef.current = setTimeout(() => {
          console.log('⏰ Host timeout - Guest never got Room ID');
          setHostTimeout(true);
          setWaitingForRoomId(false);
        }, 60000);
      }
    });
    
    socket.on('receive_room_id', (data) => {
      console.log('📥 Received Room ID:', data);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setRoomId(data.roomId);
      setWaitingForRoomId(false);
      setShowResultUpload(true);
      setAppState('IN_ACTIVE_MATCH');
    });
    
    socket.on('room_id_confirmed', (data) => {
      console.log('✅ Room ID Confirmed:', data);
      setShowResultUpload(true);
      setAppState('IN_ACTIVE_MATCH');
    });
    
    socket.on('score_submitted', (data) => {
      console.log('📊 Score Result:', data);
      if (data.approved) {
        setAppState('IDLE');
        resetMatchState();
      } else if (data.disputed) {
        setDisputeWarning(true);
        setAppState('DISPUTED');
      }
    });
    
    socket.on('opponent_disconnected', () => {
      alert('Opponent disconnected. Returning to dashboard.');
      handleReturnToDashboard();
    });
    
    socketRef.current = socket;
    
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [setAppState]);

  useEffect(() => {
    let interval;
    if (appState === 'IN_QUEUE') {
      interval = setInterval(() => setQueueTime(t => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [appState]);

  const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  const resetMatchState = () => {
    setMatchData(null);
    setRoomId('');
    setPlayerRole(null);
    setWaitingForRoomId(false);
    setShowResultUpload(false);
    setHostTimeout(false);
    setPlayerScore('');
    setOpponentScore('');
    setScreenshot(null);
    setResultMessage('');
    setDisputeWarning(false);
  };

  const handleReturnToDashboard = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    resetMatchState();
    setAppState('IDLE');
  };

  const handleFindMatch = () => {
    if (!userProfile || !user) return;
    if ((userProfile.matches_left || 100) <= 0) {
      alert('Monthly match limit reached!');
      return;
    }
    if (socketRef.current) {
      socketRef.current.emit('find_match', {
        uid: user.uid,
        elo: userProfile.elo_rating || 1500
      });
      setAppState('IN_QUEUE');
      setQueueTime(0);
    }
  };

  const handleCancelQueue = () => {
    if (socketRef.current) socketRef.current.emit('cancel_match');
    handleReturnToDashboard();
  };

  const handleSubmitRoomId = () => {
    if (!roomId.trim()) { alert('Enter Room ID'); return; }
    if (socketRef.current && matchData) {
      socketRef.current.emit('submit_room_id', {
        matchId: matchData.matchId,
        roomId: roomId.trim()
      });
    }
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied!');
  };

  const handleScreenshotUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setScreenshot(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitResult = async () => {
    if (!screenshot || !playerScore || !opponentScore) {
      setResultMessage('Enter scores and upload screenshot');
      return;
    }
    setUploading(true);
    setResultMessage('Uploading...');
    try {
      const formData = new FormData();
      formData.append('file', screenshot);
      formData.append('upload_preset', 'arena_preset');
      
      const res = await fetch(`https://api.cloudinary.com/v1_1/dwcguqqkk/image/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.secure_url) throw new Error('Upload failed');
      
      if (socketRef.current && matchData) {
        socketRef.current.emit('submit_score', {
          matchId: matchData.matchId,
          uid: user.uid,
          playerScore: parseInt(playerScore),
          opponentScore: parseInt(opponentScore),
          screenshotUrl: data.secure_url,
          isWinner: parseInt(playerScore) > parseInt(opponentScore),
          isDraw: parseInt(playerScore) === parseInt(opponentScore)
        });
        setResultMessage('Score submitted!');
      }
    } catch (err) {
      setResultMessage('Error: ' + err.message);
    }
    setUploading(false);
  };

  const getStatusText = () => {
    if (disputeWarning) return '⚠️ Match Disputed';
    if (hostTimeout) return '⚠️ Host Timed Out';
    switch (appState) {
      case 'IDLE': return 'Ready for Battle';
      case 'IN_QUEUE': return 'Searching...';
      case 'HOST_WAITING_ROOM_ID': return 'Share Room ID';
      case 'GUEST_WAITING_ROOM_ID': return 'Waiting for Host...';
      case 'IN_ACTIVE_MATCH': return 'Match in Progress';
      default: return 'Ready';
    }
  };

  const getStatusColor = () => {
    if (disputeWarning || hostTimeout) return 'rgba(239,68,68,0.15)';
    if (appState === 'IN_QUEUE') return 'rgba(6,182,212,0.15)';
    if (['HOST_WAITING_ROOM_ID','GUEST_WAITING_ROOM_ID','IN_ACTIVE_MATCH'].includes(appState)) return 'rgba(245,158,11,0.15)';
    return '#111111';
  };

  const segments = userProfile && userProfile.division >= 4 ? (() => {
    const thresh = divisionThresholds[userProfile.division] || 30;
    const pts = userProfile.points || 0;
    if (pts >= thresh) return { rel: 0, remain: 0, promo: 100 };
    const rel = Math.max(10, (10/thresh)*100);
    const promo = Math.min(10, ((pts%10)/10)*100);
    return { rel, remain: 100-rel-promo, promo };
  })() : { rel: 0, remain: 100, promo: 0 };

  return (
    <motion.div className="container" style={{ paddingTop: 24, paddingBottom: 100 }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Dashboard</h1>
        <div className={appState==='IN_QUEUE'?'animate-pulse':''} style={{
          padding: '12px 18px', borderRadius: 10, fontWeight: 600, fontSize: 14,
          background: getStatusColor(), color: appState==='IDLE'?'#a1a1aa':'#06b6d4', display: 'flex', alignItems: 'center', gap: 10
        }}>
          {appState==='IN_QUEUE' && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#06b6d4', animation: 'pulse 1.5s infinite' }}></span>}
          {getStatusText()}
          {appState==='IN_QUEUE' && <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatTime(queueTime)}</span>}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {appState === 'HOST_WAITING_ROOM_ID' && (
          <motion.div key="host" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass-card" style={{ marginBottom: 24, textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16, color: '#06b6d4' }}>🏠 Host - Create Room</h2>
            <p style={{ color: '#a1a1aa', marginBottom: 20 }}>Create a Match Room in eFootball and share the ID</p>
            <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter Room ID" className="input-field"
              style={{ marginBottom: 16, textAlign: 'center', fontSize: 24, letterSpacing: 8, fontWeight: 700 }} maxLength={8} />
            <button className="neon-button" onClick={handleSubmitRoomId} disabled={!roomId.trim()} style={{ width: '100%' }}>
              📤 Send to Opponent
            </button>
          </motion.div>
        )}

        {appState === 'GUEST_WAITING_ROOM_ID' && (
          <motion.div key="guest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass-card" style={{ marginBottom: 24, textAlign: 'center' }}>
            {waitingForRoomId && !hostTimeout && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ width: 60, height: 60, borderRadius: '50%', border: '3px solid #06b6d4', borderTopColor: 'transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
                </div>
                <h2 style={{ marginBottom: 8 }}>⏳ Waiting for Host...</h2>
                <p style={{ color: '#a1a1aa' }}>Host will share Room ID shortly</p>
                <p style={{ color: '#71717a', fontSize: 12, marginTop: 16 }}>Timeout: 60s</p>
              </>
            )}
            {hostTimeout && (
              <>
                <h2 style={{ marginBottom: 8, color: '#ef4444' }}>⚠️ Host Timed Out</h2>
                <p style={{ color: '#a1a1aa', marginBottom: 20 }}>Host didn't share Room ID in time</p>
                <button className="neon-button" onClick={handleReturnToDashboard} style={{ width: '100%' }}>
                  Return to Dashboard
                </button>
              </>
            )}
          </motion.div>
        )}

        {showResultUpload && appState === 'IN_ACTIVE_MATCH' && (
          <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="glass-card" style={{ marginBottom: 24 }}>
            <h2 style={{ marginBottom: 16, textAlign: 'center' }}>🎮 Match in Progress</h2>
            {roomId && (
              <div style={{ textAlign: 'center', marginBottom: 20, padding: 12, background: '#111', borderRadius: 8 }}>
                <p style={{ color: '#a1a1aa', fontSize: 12 }}>Room ID</p>
                <p style={{ fontSize: 28, fontWeight: 700, color: '#06b6d4', letterSpacing: 4 }}>{roomId}</p>
                <button onClick={handleCopyRoomId} className="outline-button" style={{ marginTop: 12, width: '100%' }}>
                  📋 Copy & Open eFootball
                </button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, color: '#a1a1aa', fontSize: 14 }}>Your Score</label>
                <input type="number" value={playerScore} onChange={(e) => setPlayerScore(e.target.value)}
                  placeholder="0" className="input-field" style={{ textAlign: 'center', fontSize: 24, fontWeight: 700 }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 8, color: '#a1a1aa', fontSize: 14 }}>Opponent Score</label>
                <input type="number" value={opponentScore} onChange={(e) => setOpponentScore(e.target.value)}
                  placeholder="0" className="input-field" style={{ textAlign: 'center', fontSize: 24, fontWeight: 700 }} />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: '#a1a1aa', fontSize: 14 }}>📸 Screenshot</label>
              <input type="file" accept="image/*" onChange={handleScreenshotUpload} className="input-field" style={{ padding: 12 }} />
              {screenshot && <img src={screenshot} alt="Preview" style={{ width: 100, marginTop: 8, borderRadius: 4 }} />}
            </div>
            {resultMessage && <div style={{ padding: 12, borderRadius: 8, marginBottom: 16, background: resultMessage.includes('Error')?'rgba(239,68,68,0.1)':'rgba(6,182,212,0.1)', color: resultMessage.includes('Error')?'#ef4444':'#06b6d4', textAlign: 'center' }}>{resultMessage}</div>}
            <button className="neon-button" onClick={handleSubmitResult} disabled={uploading||!screenshot||!playerScore||!opponentScore} style={{ width: '100%' }}>
              {uploading ? '⏳' : '✅'} Submit Result
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {appState === 'IDLE' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 12, marginBottom: 24 }}>
            <div className="division-card" style={{ padding: '20px 16px' }}>
              <div className="division-number" style={{ fontSize: 48 }}>{userProfile?.division || 10}</div>
              <div className="division-label" style={{ fontSize: 12 }}>Division</div>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
              {userProfile?.division >= 4 ? (
                <>
                  <p style={{ color: '#a1a1aa', fontSize: 12 }}>Points</p>
                  <p style={{ fontSize: 28, fontWeight: 700, color: '#06b6d4', marginTop: 4 }}>{userProfile?.points || 0}<span style={{ fontSize: 14, color: '#71717a' }}>/{divisionThresholds[userProfile?.division||10]}</span></p>
                </>
              ) : (
                <>
                  <p style={{ color: '#a1a1aa', fontSize: 12 }}>Elo</p>
                  <p style={{ fontSize: 28, fontWeight: 700, color: '#22d3ee', marginTop: 4 }}>{userProfile?.elo_rating || 1500}</p>
                </>
              )}
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
              <p style={{ color: '#a1a1aa', fontSize: 12 }}>Matches Left</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{userProfile?.matches_left || 100}</p>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
              <p style={{ color: '#a1a1aa', fontSize: 12 }}>Win Rate</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b', marginTop: 4 }}>{userProfile?.win_rate || 0}%</p>
            </div>
            <div className="glass-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
              <p style={{ color: '#a1a1aa', fontSize: 12 }}>Rank</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>#{userProfile?.global_rank || '-'}</p>
            </div>
          </div>

          {userProfile?.division >= 4 && (
            <div className="glass-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 14, fontSize: 16 }}>Promotion Progress</h3>
              <div className="progress-bar" style={{ height: 16 }}>
                <div style={{ display: 'flex', height: '100%', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${segments.rel}%`, background: '#ef4444' }}></div>
                  <div style={{ width: `${segments.remain}%`, background: '#71717a' }}></div>
                  <div style={{ width: `${segments.promo}%`, background: '#10b981' }}></div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#71717a' }}>
                <span>Relegation</span><span>Safe</span><span>Promo</span>
              </div>
            </div>
          )}

          <div className="glass-card" style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 14, fontSize: 16 }}>Last 5 Matches</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {(userProfile?.last_5_form || []).length > 0 ? userProfile.last_5_form.map((r,i) => (
                <div key={i} style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, background: r==='W'?'#10b981':r==='D'?'#71717a':'#ef4444', color: 'white' }}>{r}</div>
              )) : <p style={{ color: '#71717a', fontSize: 14 }}>No matches yet</p>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="neon-button" onClick={handleFindMatch} disabled={!userProfile || userProfile.matches_left <= 0} style={{ padding: '16px 40px', fontSize: 16 }}>
              Find Match
            </button>
          </div>
        </motion.div>
      )}

      {appState === 'IN_QUEUE' && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button className="outline-button" onClick={handleCancelQueue} style={{ padding: '16px 40px', fontSize: 16 }}>
            Cancel Queue
          </button>
        </div>
      )}
    </motion.div>
  );
};

export default Dashboard;
