import { create } from 'zustand';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, getDataFromCollection } from '../../firebase';

type ACLUser = {
  eid: number;
  email: string;
  location: string;
  name: string;
  title: string;
  photoURL?: string;
};

type AuthState = {
  user: User | null;
  aclUser: ACLUser | null;
  superUsers: string[];
  loading: boolean;
  setAuth: (user: ACLUser) => void;
  clearAuth: () => void;
  initAuth: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  aclUser: null, 
  superUsers: [],
  loading: true,
  setAuth: (aclUser) => set({ aclUser, loading: false }),
  clearAuth: () => {
    set({ user: null, aclUser: null, loading: false });
    auth.signOut();
  },
  initAuth: () => {
    return new Promise<void>((resolve) => {
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          const [aclUsers, superUserDocs] = await Promise.all([
            getDataFromCollection<ACLUser>('allowed_users'),
            getDataFromCollection<{ email: string }>('super_users')
          ]);

          const superUserEmails = superUserDocs.map(doc => doc.email);

          const currentUser = aclUsers.find((user) => user.email === firebaseUser.email);

          if (currentUser) {
            const aclUserWithPhoto: ACLUser = {
              ...currentUser,
              photoURL: firebaseUser.photoURL || '',
            };
            set({ user: firebaseUser, aclUser: aclUserWithPhoto, superUsers: superUserEmails, loading: false });
          } else {
            auth.signOut();
            set({ user: null, aclUser: null, superUsers: [], loading: false });
          }
        } else {
          set({ user: null, aclUser: null, superUsers: [], loading: false });
        }
        resolve();
      });
    });
  },
}));


