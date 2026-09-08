"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "firebase/auth";
import {
  subscribeAuthState,
  signInWithGoogle,
  signOutCurrentUser,
  getAuthErrorDetails,
  AuthErrorInfo
} from "./auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: AuthErrorInfo | null;
  clearError: () => void;
  signInGoogle: () => Promise<User | null>;
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
