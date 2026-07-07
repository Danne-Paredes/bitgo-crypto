import { useState, useEffect } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut
} from 'firebase/auth';
import { auth, provider, ALLOWED_DOMAINS } from '../../firebase';
import { useAuthStore } from '../store/auth-store';
import { useNavigate } from 'react-router-dom';
import GoogleButton from 'react-google-button';
import logo from '../images/KVLogo.png';

const isSafari = () => {
  const ua = navigator.userAgent.toLowerCase();
  return ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1;
};

const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
};

export default function Login() {
  const navigate = useNavigate();
  const { aclUser, initAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          const email = result.user.email ?? '';
          const domain = email.split('@')[1];
          if (!ALLOWED_DOMAINS.includes(domain)) {
            await signOut(auth);
            setError(`Access restricted. Only ${ALLOWED_DOMAINS.join(' or ')} accounts are allowed.`);
            return;
          }
          await initAuth();
        }
      } catch (error: any) {
        console.error('Error checking redirect result:', error);
        setError('Authentication failed. Please try again.');
      }
    };

    checkRedirectResult();
  }, [initAuth]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !aclUser) {
        await initAuth();
      }
    });

    return () => unsubscribe();
  }, [initAuth, aclUser]);

  useEffect(() => {
    if (aclUser) {
      navigate('/');
    }
  }, [aclUser, navigate]);

  const signInWithGoogle = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('firebase:')) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}

    try {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (persistenceErr: any) {
        if (
          persistenceErr.name === 'QuotaExceededError' ||
          persistenceErr.message?.includes('quota')
        ) {
          await setPersistence(auth, browserSessionPersistence);
        } else {
          throw persistenceErr;
        }
      }

      try {
        const result = await signInWithPopup(auth, provider);
        const email = result.user.email ?? '';
        const domain = email.split('@')[1];
        if (!ALLOWED_DOMAINS.includes(domain)) {
          await signOut(auth);
          setError(`Access restricted. Only ${ALLOWED_DOMAINS.join(' or ')} accounts are allowed.`);
          setIsLoading(false);
          return;
        }
        await initAuth();
      } catch (popupError: any) {
        if (
          popupError.code === 'auth/popup-blocked' ||
          popupError.code === 'auth/popup-closed-by-user'
        ) {
          if (isIOS()) {
            setError('Popup blocked on iOS. Please:\n1. Open this page in Safari (not in-app browser)\n2. Allow popups in Safari Settings\n3. Try again');
          } else {
            setError('Popup was blocked. Please allow popups for this site and try again.');
          }
          setIsLoading(false);
          return;
        }

        if (
          popupError.name === 'QuotaExceededError' ||
          popupError.message?.includes('quota') ||
          popupError.message?.includes('exceeded')
        ) {
          try {
            await setPersistence(auth, browserSessionPersistence);
            const result = await signInWithPopup(auth, provider);
            const email = result.user.email ?? '';
            const domain = email.split('@')[1];
            if (!ALLOWED_DOMAINS.includes(domain)) {
              await signOut(auth);
              setError(`Access restricted. Only ${ALLOWED_DOMAINS.join(' or ')} accounts are allowed.`);
              setIsLoading(false);
              return;
            }
            await initAuth();
            return;
          } catch (retryErr: any) {
            throw retryErr;
          }
        }

        if (
          popupError.message?.includes('missing initial state') ||
          popupError.message?.includes('sessionStorage')
        ) {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupError;
      }
    } catch (error: any) {
      console.error('Error signing in with Google:', error);
      if (
        error.name === 'QuotaExceededError' ||
        error.message?.includes('quota') ||
        error.message?.includes('exceeded')
      ) {
        setError('Browser storage is full. Please clear your browser data (Settings → Clear browsing data → Cached images and cookies) and try again.');
      } else {
        setError(
          error.code === 'auth/unauthorized-domain'
            ? 'This domain is not authorized. Please contact support.'
            : 'Sign-in failed. Please try again or use a different browser.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-10 bg-black px-5 max-w-md justify-center flex-col align-middle items-center pb-2">
      <img className="mx-auto p-5" src={logo} alt="KV Logo" />
      <p className="text-kv-logo-gray primary text-center">
        Please login with your Knighted Account
      </p>

      {error && (
        <p className="text-red-500 text-center text-sm mt-2 mb-2 whitespace-pre-line">{error}</p>
      )}

      <div className="mx-auto">
        <GoogleButton
          onClick={signInWithGoogle}
          className="mx-auto my-4"
          disabled={isLoading}
        />
      </div>

      {(isSafari() || isIOS()) && (
        <p className="text-gray-400 text-xs text-center mt-2">
          {isIOS()
            ? '📱 iOS detected - popup authentication (open in Safari if blocked)'
            : '🖥️ Safari detected - popup authentication (allow popups if blocked)'}
        </p>
      )}
    </div>
  );
};
