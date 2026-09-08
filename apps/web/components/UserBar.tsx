"use client";

import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";

export default function UserBar() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const displayName = user.displayName || user.email?.split("@")[0] || "Yönetici";
  const userInitials = (displayName.charAt(0) || "A").toUpperCase();

  return (
    <header style={{
      backgroundColor: "rgba(18, 24, 36, 0.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-subtle)",
      padding: "10px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 50
    }}>
      {/* Brand & App Info */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          backgroundColor: "rgba(197, 160, 89, 0.15)",
          border: "1px solid var(--border-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent-gold)",
          fontWeight: 700,
          fontSize: "14px"
        }}>
          A
        </div>
        <div>
          <div style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "0.04em"
          }}>
            B.U.T.L.E.R. Alfred
          </div>
          <div style={{
            fontSize: "11px",
            color: "var(--accent-gold-light)",
            display: "flex",
            alignItems: "center",
            gap: "5px"
          }}>
            <span style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: "var(--success)",
              boxShadow: "0 0 8px var(--success)"
            }} />
            <span>Oturum Doğrulandı</span>
          </div>
        </div>
      </div>

      {/* User Info & Sign Out */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={displayName}
              referrerPolicy="no-referrer"
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "50%",
                border: "1.5px solid var(--border-accent)",
                objectFit: "cover"
              }}
            />
          ) : (
            <div style={{
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              backgroundColor: "var(--bg-card-hover)",
              border: "1.5px solid var(--border-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-gold)",
              fontWeight: 600,
              fontSize: "13px"
            }}>
              {userInitials}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", textAlign: "right" }}>
            <span style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-primary)"
            }}>
              {displayName}
            </span>
            <span style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              maxWidth: "200px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
              {user.email || "Google Hesabı"}
            </span>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          title="Oturumu Kapat"
          style={{
            padding: "6px 14px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "8px",
            color: "#fca5a5",
            fontSize: "12px",
            fontWeight: 500,
            cursor: loggingOut ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s ease",
            opacity: loggingOut ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!loggingOut) {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
              e.currentTarget.style.borderColor = "#ef4444";
            }
          }}
          onMouseLeave={(e) => {
            if (!loggingOut) {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{loggingOut ? "Çıkılıyor..." : "Çıkış Yap"}</span>
        </button>
      </div>
    </header>
  );
}
