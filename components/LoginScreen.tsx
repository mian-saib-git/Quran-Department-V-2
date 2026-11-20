import React, { useState } from "react";
import { loginToDjango } from "../services/djangoApiService";
import type { Session } from "../services/sessionService";

export const REMEMBERED_LOGIN_KEY = "ivs_remembered_username";

export type LoginScreenProps = {
  onLoginSuccess: (nextSession: Session) => void;
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [loginUsername, setLoginUsername] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_LOGIN_KEY) || "";
    } catch {
      return "";
    }
  });

  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [rememberLogin, setRememberLogin] = useState(() => {
    try {
      return Boolean(localStorage.getItem(REMEMBERED_LOGIN_KEY));
    } catch {
      return false;
    }
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const username = loginUsername.trim();
    const password = loginPassword;

    if (!username || !password) {
      setLoginError("Please enter username and password.");
      return;
    }

    try {
      setLoginLoading(true);
      setLoginError("");

      const nextSession = await loginToDjango(username, password);

      if (rememberLogin) {
        try {
          localStorage.setItem(REMEMBERED_LOGIN_KEY, username);
        } catch {
          // ignore
        }
      } else {
        try {
          localStorage.removeItem(REMEMBERED_LOGIN_KEY);
        } catch {
          // ignore
        }
      }

      onLoginSuccess(nextSession);

      setLoginUsername("");
      setLoginPassword("");
    } catch (err: any) {
      setLoginError(err?.message || "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes ivsIn {
          from { opacity: 0; transform: translateY(28px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes ivsGrid {
          0% { background-position: 0 0; }
          100% { background-position: 0 56px; }
        }

        @keyframes ivsOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(18px, -18px) scale(1.04); }
        }

        @keyframes ivsOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-18px, 18px) scale(1.04); }
        }

        @keyframes ivsShine {
          from { transform: translateX(-130%) skewX(-18deg); }
          to { transform: translateX(220%) skewX(-18deg); }
        }

        @keyframes ivsSpin {
          to { transform: rotate(360deg); }
        }

        .ivs-login-root * {
          box-sizing: border-box;
        }

        .ivs-login-scene {
          position: relative;
          min-height: 100vh;
          width: 100%;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
          background: #edeaf5;
        }

        .ivs-login-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #edeaf5;
        }

        .ivs-login-bg picture,
        .ivs-login-bg-image {
          display: block;
          width: 100%;
          height: 100%;
        }

        .ivs-login-bg-image {
          object-fit: cover;
          object-position: center;
        }

        .ivs-login-bg::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% 16%, rgba(139,92,246,0.20), transparent 35%),
            radial-gradient(circle at 84% 88%, rgba(168,85,247,0.18), transparent 34%),
            linear-gradient(120deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)),
            linear-gradient(rgba(35,20,80,0.10), rgba(35,20,80,0.10));
          pointer-events: none;
        }

        .ivs-login-grid {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 52%;
          background-image:
            linear-gradient(rgba(99,102,241,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.055) 1px, transparent 1px);
          background-size: 56px 56px;
          transform: perspective(700px) rotateX(62deg);
          transform-origin: bottom center;
          -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,0.16), transparent 72%);
          mask-image: linear-gradient(to top, rgba(0,0,0,0.16), transparent 72%);
          animation: ivsGrid 6s linear infinite;
          pointer-events: none;
        }

        .ivs-login-orb {
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
        }

        .ivs-login-orb-1 {
          width: 360px;
          height: 360px;
          top: -90px;
          left: -90px;
          background: radial-gradient(circle at 38% 36%, rgba(167,139,250,0.24), rgba(139,92,246,0.06) 62%, transparent);
          border: 1px solid rgba(167,139,250,0.10);
          animation: ivsOrb1 20s ease-in-out infinite;
        }

        .ivs-login-orb-2 {
          width: 290px;
          height: 290px;
          bottom: -70px;
          right: -70px;
          background: radial-gradient(circle at 62% 34%, rgba(99,102,241,0.18), rgba(79,70,229,0.05) 62%, transparent);
          border: 1px solid rgba(99,102,241,0.08);
          animation: ivsOrb2 24s ease-in-out infinite;
        }

        .ivs-login-card {
          position: relative;
          z-index: 10;
          width: 500px;
          max-width: 94vw;
          border-radius: 36px;
          padding: 48px 48px 40px;
          overflow: hidden;

          background: rgba(255,255,255,0.02);
          backdrop-filter: blur(18px) saturate(145%);
          -webkit-backdrop-filter: blur(18px) saturate(145%);

          border: 1px solid rgba(255,255,255,0.58);

          box-shadow:
            16px 18px 38px rgba(76, 62, 121, 0.22),
            0 24px 70px rgba(79,70,229,0.20),
            inset 0 1px 0 rgba(255,255,255,0.35),
            inset 0 -1px 0 rgba(255,255,255,0.12);

          animation: ivsIn 0.75s cubic-bezier(0.22,1,0.36,1) both;
        }

        .ivs-login-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 36px;
          pointer-events: none;
          background: transparent;
        }

        .ivs-login-inner {
          position: relative;
          z-index: 1;
        }

        .ivs-login-brand {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 36px;
        }

.ivs-login-logo {
  width: 70px;
  height: 70px;
  border-radius: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.20);
  border: 1px solid rgba(255,255,255,0.48);
  box-shadow:
    8px 10px 22px rgba(76,62,121,0.20),
    inset 0 1px 0 rgba(255,255,255,0.42);
  overflow: hidden;
}

.ivs-login-logo-img {
  width: 58px;
  height: 58px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 8px 14px rgba(30,27,75,0.18));
}

        .ivs-login-school {
          font-size: 20px;
          font-weight: 800;
          color: #1e1b4b;
          line-height: 1.15;
          letter-spacing: -0.3px;
        }

        .ivs-login-sub {
          font-size: 12.5px;
          font-weight: 600;
          color: #6d5f98;
          margin-top: 3px;
        }

        .ivs-login-title {
          font-size: 52px;
          font-weight: 900;
          letter-spacing: -2.5px;
          line-height: 1;
          color: #1e1b4b;
          margin-bottom: 34px;
        }

        .ivs-login-field {
          margin-bottom: 20px;
        }

        .ivs-login-label {
          display: block;
          font-size: 13px;
          font-weight: 800;
          color: #1e1b4b;
          margin-bottom: 9px;
          letter-spacing: 0.2px;
        }

        .ivs-login-input-wrap {
          position: relative;
        }

        .ivs-login-input {
          width: 100%;
          border-radius: 20px;
          padding: 15px 62px 15px 20px;
          font-size: 15px;
          font-weight: 650;
          color: #1e1b4b;
          outline: none;
          border: 1px solid rgba(255,255,255,0.62);
          background: rgba(255,255,255,0.24);
          box-shadow:
            inset 4px 4px 12px rgba(120,100,170,0.16),
            inset -4px -4px 12px rgba(255,255,255,0.46),
            0 1px 0 rgba(255,255,255,0.45);
          transition: all 0.22s ease;
        }

        .ivs-login-input::placeholder {
          color: #8f89ad;
          font-weight: 500;
        }

        .ivs-login-input:focus {
          background: rgba(255,255,255,0.32);
          border-color: rgba(99,102,241,0.46);
          box-shadow:
            inset 4px 4px 12px rgba(99,102,241,0.11),
            inset -4px -4px 12px rgba(255,255,255,0.52),
            0 0 0 4px rgba(99,102,241,0.12),
            0 8px 22px rgba(79,70,229,0.12);
          transform: translateY(-1px);
        }

        .ivs-login-icon,
        .ivs-login-eye {
          position: absolute;
          right: 11px;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          border-radius: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4f46e5;
          background: rgba(255,255,255,0.28);
          border: 1px solid rgba(255,255,255,0.55);
          box-shadow:
            5px 6px 14px rgba(76,62,121,0.14),
            inset 0 1px 0 rgba(255,255,255,0.46);
        }

        .ivs-login-icon {
          pointer-events: none;
        }

        .ivs-login-eye {
          cursor: pointer;
          outline: none;
          transition: all 0.18s ease;
        }

        .ivs-login-eye:hover {
          background: rgba(255,255,255,0.38);
          transform: translateY(-50%) scale(1.04);
        }

        .ivs-login-options {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          margin: 2px 0 18px;
        }

        .ivs-login-remember {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          user-select: none;
          color: #1e1b4b;
          font-size: 13px;
          font-weight: 800;
        }

        .ivs-login-checkbox {
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.68);
          background: rgba(255,255,255,0.26);
          box-shadow:
            inset 2px 2px 6px rgba(120,100,170,0.16),
            inset -2px -2px 6px rgba(255,255,255,0.48);
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
        }

        .ivs-login-checkbox:checked {
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          border-color: rgba(255,255,255,0.72);
          box-shadow:
            0 8px 18px rgba(79,70,229,0.24),
            inset 0 1px 0 rgba(255,255,255,0.28);
        }

        .ivs-login-checkbox:checked::after {
          content: "✓";
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -54%);
          color: white;
          font-size: 12px;
          font-weight: 900;
        }

        .ivs-login-error {
          background: rgba(254,226,226,0.78);
          border: 1px solid rgba(239,68,68,0.22);
          border-radius: 14px;
          padding: 11px 16px;
          font-size: 13px;
          font-weight: 700;
          color: #b91c1c;
          margin-bottom: 16px;
          box-shadow:
            inset 3px 3px 8px rgba(239,68,68,0.10),
            inset -3px -3px 8px rgba(255,255,255,0.45);
        }

        .ivs-login-btn {
          position: relative;
          width: 100%;
          margin-top: 10px;
          padding: 16px 24px;
          border: none;
          border-radius: 22px;
          cursor: pointer;
          font-size: 17px;
          font-weight: 900;
          color: #fff;
          letter-spacing: -0.2px;
          overflow: hidden;
          background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 52%, #4338ca 100%);
          box-shadow:
            7px 9px 20px rgba(79,70,229,0.38),
            0 18px 42px rgba(79,70,229,0.32),
            inset 0 1px 0 rgba(255,255,255,0.26);
          transition: all 0.22s ease;
        }

        .ivs-login-btn:hover {
          transform: translateY(-3px);
          box-shadow:
            8px 12px 24px rgba(79,70,229,0.46),
            0 24px 54px rgba(79,70,229,0.38),
            inset 0 1px 0 rgba(255,255,255,0.30);
        }

        .ivs-login-btn:active {
          transform: translateY(1px) scale(0.99);
          box-shadow:
            inset 4px 4px 12px rgba(79,70,229,0.40),
            inset -4px -4px 12px rgba(255,255,255,0.15),
            0 8px 20px rgba(79,70,229,0.28);
        }

        .ivs-login-btn:disabled {
          opacity: 0.60;
          cursor: not-allowed;
          transform: none;
        }

        .ivs-login-btn::before {
          content: "";
          position: absolute;
          inset-y: 0;
          left: -100%;
          width: 52%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
          transform: skewX(-18deg);
          pointer-events: none;
        }

        .ivs-login-btn:hover::before {
          animation: ivsShine 0.60s ease-out forwards;
        }

        .ivs-login-btn-inner {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .ivs-login-spinner {
          width: 17px;
          height: 17px;
          border-radius: 999px;
          border: 2.5px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          animation: ivsSpin 0.7s linear infinite;
          flex-shrink: 0;
        }

        .ivs-login-footer {
          margin-top: 22px;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: rgba(30,27,75,0.46);
        }

        @media (max-width: 560px) {
          .ivs-login-scene {
            padding: 1rem;
          }

          .ivs-login-card {
            padding: 34px 24px 30px;
            border-radius: 28px;
          }

          .ivs-login-title {
            font-size: 42px;
          }

          .ivs-login-school {
            font-size: 17px;
          }

          .ivs-login-logo {
            width: 56px;
            height: 56px;
            border-radius: 20px;
          }

          .ivs-login-logo-inner {
            width: 40px;
            height: 40px;
          }

          .ivs-login-options {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>

      <div className="ivs-login-root">
        <div className="ivs-login-scene">
          <div className="ivs-login-bg" aria-hidden="true">
            <picture>
              <source
                media="(max-width: 600px) and (orientation: portrait)"
                srcSet="/login-bg-mobile.webp"
                type="image/webp"
              />
              <img
                className="ivs-login-bg-image"
                src="/login-bg.webp"
                alt=""
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </div>
          <div className="ivs-login-grid" />

          <div className="ivs-login-orb ivs-login-orb-1" />
          <div className="ivs-login-orb ivs-login-orb-2" />

          <div className="ivs-login-card">
            <div className="ivs-login-inner">
              <div className="ivs-login-brand">
                <div className="ivs-login-logo">
                  <img
                    src="/ivs-logo.webp"
                    alt="Iqra Virtual School"
                    className="ivs-login-logo-img"
                  />
                </div>

                <div>
                  <div className="ivs-login-school">Iqra Virtual School</div>
                  <div className="ivs-login-sub">School Management Portal</div>
                </div>
              </div>

              <h1 className="ivs-login-title">Login</h1>

              <form onSubmit={handleLogin}>
                <div className="ivs-login-field">
                  <label className="ivs-login-label" htmlFor="ivs-username">
                    Username
                  </label>

                  <div className="ivs-login-input-wrap">
                    <input
                      id="ivs-username"
                      type="text"
                      className="ivs-login-input"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="Enter username"
                      autoComplete="username"
                    />

                    <div className="ivs-login-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M20 21a8 8 0 0 0-16 0"
                          stroke="currentColor"
                          strokeWidth="2.3"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="12"
                          cy="8"
                          r="4"
                          stroke="currentColor"
                          strokeWidth="2.3"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="ivs-login-field">
                  <label className="ivs-login-label" htmlFor="ivs-password">
                    Password
                  </label>

                  <div className="ivs-login-input-wrap">
                    <input
                      id="ivs-password"
                      type={showLoginPassword ? "text" : "password"}
                      className="ivs-login-input"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />

                    <button
                      type="button"
                      className="ivs-login-eye"
                      onClick={() => setShowLoginPassword((value) => !value)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                    >
                      {showLoginPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M3 3l18 18"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M10.6 10.6a2.2 2.2 0 0 0 3.1 3.1"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M7.2 7.5C4.8 8.9 3.5 11 3 12c1.1 2.2 4.5 6 9 6 1.5 0 2.8-.4 4-1"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M12 6c4.5 0 7.9 3.8 9 6-.3.7-1.1 1.8-2.2 2.8"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinejoin="round"
                          />
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            stroke="currentColor"
                            strokeWidth="2.2"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="ivs-login-options">
                  <label className="ivs-login-remember">
                    <input
                      type="checkbox"
                      className="ivs-login-checkbox"
                      checked={rememberLogin}
                      onChange={(e) => setRememberLogin(e.target.checked)}
                    />
                    Remember me
                  </label>
                </div>

                {loginError && (
                  <div className="ivs-login-error">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  className="ivs-login-btn"
                  disabled={loginLoading}
                >
                  <span className="ivs-login-btn-inner">
                    {loginLoading && <span className="ivs-login-spinner" />}
                    {loginLoading ? "Signing in..." : "Sign in"}
                  </span>
                </button>
              </form>

              <div className="ivs-login-footer">
                © 2026 Iqra Virtual School
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default LoginScreen;
