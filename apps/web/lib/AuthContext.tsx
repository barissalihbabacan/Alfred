"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, RecaptchaVerifier } from "firebase/auth";
import {
  subscribeAuthState,
  signInWithGoogle,
  signOutCurrentUser,
  signInUser,
  getAuthErrorDetails,
  AuthErrorInfo,
  MfaChallenge
} from "./auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: AuthErrorInfo | null;
  clearError: () => void;
  signInGoogle: () => Promise<User | null>;
  signInEmail: (email: string, pass: string, appVerifier: RecaptchaVerifier) => Promise<{ user?: User; mfaChallenge?: MfaChallenge } | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<AuthErrorInfo | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAuthState((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const clearError = () => setError(null);

  const signInGoogle = async (): Promise<User | null> => {
    clearError();
    try {
      const loggedUser = await signInWithGoogle();
      return loggedUser;
    } catch (err: any) {
      const details = getAuthErrorDetails(err);
      setError(details);
      return null;
    }
  };

  const signInEmail = async (
    email: string,
    pass: string,
    appVerifier: RecaptchaVerifier
  ) => {
    clearError();
    try {
      const res = await signInUser(email, pass, appVerifier);
      return res;
    } catch (err: any) {
      const details = getAuthErrorDetails(err);
      setError(details);
      return null;
    }
  };

  const logout = async () => {
    clearError();
    try {
      await signOutCurrentUser();
      setUser(null);
    } catch (err: any) {
      const details = getAuthErrorDetails(err);
      setError(details);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        clearError,
        signInGoogle,
        signInEmail,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
