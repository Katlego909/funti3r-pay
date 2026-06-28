import { useState } from 'react';
import { registerPasskey } from '../api/auth';

export function AuthComponent() {
  const [status, setStatus] = useState<string>('Ready');
  const [email, setEmail] = useState<string>('');

  const handleRegister = async () => {
    if (!email) {
      setStatus('Please enter an email');
      return;
    }
    setStatus('Registering...');
    try {
      const result = await registerPasskey(email);
      console.log('Registration successful:', result);
      setStatus('Registered successfully!');
    } catch (e) {
      console.error(e);
      setStatus('Registration failed: ' + String(e));
    }
  };

  return (
    <div className="auth-box">
      <h3>Passkey Auth</h3>
      <p>Status: {status}</p>
      <input
        type="email"
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button onClick={handleRegister}>Register Passkey</button>
    </div>
  );
}
