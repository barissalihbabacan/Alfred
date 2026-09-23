"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { User } from "firebase/auth";
import {
  subscribeAuthState,
  signInWithGoogle,
  signInWithGoogleRedirect,
  checkRedirectResult,
  signOutCurrentUser,
  getAuthErrorDetails,
  AuthErrorInfo
} from "./auth";

interface AuthContextType {
  user: User | null;
  /** true until Firebase has restored (or ruled out) a persisted session. */
  loading: boolean;
  error: AuthErrorInfo | null;
  clearError: () => void;
  signInGoogle: () => Promise<User | null>;
  signInGoogleRedirect: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<AuthErrorInfo | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeAuthState(
      (currentUser) => {
        setUser(currentUser);
        setLoading(false);
      },
      () => setError(getAuthErrorDetails({ code: "auth/unauthorized-uid" }))
    );

    // Yonlendirmeli giristen donuste olusan hatalar (ornegin Safari'de
    // "missing initial state") yalnizca getRedirectResult ile yakalanir.
    checkRedirectResult().catch((err) => setError(getAuthErrorDetails(err)));

    return () => unsubscribe();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const signInGoogle = useCallback(async (): Promise<User | null> => {
    setError(null);
    try {
      return await signInWithGoogle();
    } catch (err: any) {
      console.error("[Auth] Google Sign-In error:", err);
      setError(getAuthErrorDetails(err));
      return null;
    }
  }, []);

  const signInGoogleRedirect = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await signInWithGoogleRedirect();
    } catch (err: any) {
      console.error("[Auth] Direct redirect sign-in error:", err);
      setError(getAuthErrorDetails(err));
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await signOutCurrentUser();
      setUser(null);
    } catch (err: any) {
      setError(getAuthErrorDetails(err));
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        clearError,
        signInGoogle,
        signInGoogleRedirect,
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
