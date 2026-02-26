import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFirebase } from '../context/FirebaseContext';

const AuthPage = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const { signIn, signUp } = useFirebase();
  const navigate = useNavigate();

  // Email regex validation
  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);
    // Clear error when user starts typing
    if (emailError) setEmailError('');
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setEmailError('');
    setLoading(true);

    try {
      // Trim and validate email
      const trimmedEmail = email.trim();
      
      if (!trimmedEmail) {
        setEmailError('Email is required');
        setLoading(false);
        return;
      }

      if (!isValidEmail(trimmedEmail)) {
        setEmailError('Please enter a valid email address (e.g., user@example.com)');
        setLoading(false);
        return;
      }

      if (isSignUp) {
        if (!username.trim()) {
          setError('Username is required');
          setLoading(false);
          return;
        }
        await signUp(trimmedEmail, password, username.trim());
      } else {
        await signIn(trimmedEmail, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#050505',
      padding: '24px'
    }}>
      {/* Background Effects */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(6, 182, 212, 0.15) 0%, transparent 70%)',
        pointerEvents: 'none'
      }}></div>

      <div className="glass-card animate-slide-in" style={{
        maxWidth: '450px',
        width: '100%',
        padding: '48px 40px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '42px',
            fontWeight: 800,
            background: 'linear-gradient(135deg, #06b6d4, #22d3ee)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '4px'
          }}>
            ARENAPLAY
          </h1>
          <p style={{
            color: '#71717a',
            fontSize: '14px',
            letterSpacing: '3px',
            marginTop: '8px',
            textTransform: 'uppercase'
          }}>
            Compete • Connect • Conquer
          </p>
        </div>

        {/* Toggle Buttons */}
        <div style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '32px'
        }}>
          <button
            onClick={() => setIsSignUp(false)}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              background: !isSignUp ? 'linear-gradient(135deg, #06b6d4, #22d3ee)' : '#111111',
              color: !isSignUp ? '#050505' : '#71717a'
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => setIsSignUp(true)}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '14px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              background: isSignUp ? 'linear-gradient(135deg, #06b6d4, #22d3ee)' : '#111111',
              color: isSignUp ? '#050505' : '#71717a'
            }}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {isSignUp && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                color: '#a1a1aa',
                fontSize: '14px',
                fontWeight: 500
              }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required={isSignUp}
                className="input-field"
                style={{ minHeight: '50px' }}
              />
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#a1a1aa',
              fontSize: '14px',
              fontWeight: 500
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              placeholder="Enter your email"
              required
              className="input-field"
              style={{ 
                minHeight: '50px',
                borderColor: emailError ? '#ef4444' : undefined
              }}
            />
            {emailError && (
              <p style={{
                color: '#ef4444',
                fontSize: '12px',
                marginTop: '6px'
              }}>
                {emailError}
              </p>
            )}
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#a1a1aa',
              fontSize: '14px',
              fontWeight: 500
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="input-field"
              style={{ minHeight: '50px' }}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              color: '#ef4444',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="neon-button"
            style={{
              width: '100%',
              minHeight: '54px',
              fontSize: '16px'
            }}
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Divider */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          margin: '32px 0',
          gap: '16px'
        }}>
          <div style={{ flex: 1, height: '1px', background: '#27272a' }}></div>
          <span style={{ color: '#71717a', fontSize: '12px' }}>PREMIUM eSPORTS</span>
          <div style={{ flex: 1, height: '1px', background: '#27272a' }}></div>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          color: '#71717a',
          fontSize: '12px'
        }}>
          By continuing, you agree to ArenaPlay's Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
