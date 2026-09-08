import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  multiFactor,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  User,
  MultiFactorResolver,
  PhoneMultiFactorInfo,
  Auth
} from "firebase/auth";
import { app } from "./firebase";

let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(app);
  }
  return authInstance;
}

export interface MfaChallenge {
  resolver: MultiFactorResolver;
  verificationId: string;
  phoneHint: PhoneMultiFactorInfo;
}

/**
 * Sign in user with email and password.
 * Returns { user } if successful, or { mfaRequired: true, challenge } if second-factor SMS is needed.
 */
export async function signInUser(
  email: string,
  pass: string,
  appVerifier: RecaptchaVerifier
): Promise<{ user?: User; mfaChallenge?: MfaChallenge }> {
  const auth = getFirebaseAuth();
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    return { user: cred.user };
  } catch (error: any) {
    if (error.code === "auth/multi-factor-auth-required") {
      const resolver = getMultiFactorResolver(auth, error);
      const phoneHint = resolver.hints.find(
        (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      ) as PhoneMultiFactorInfo;

      if (!phoneHint) {
        throw new Error("SMS Multi-Factor hint not found on account.");
      }

      const phoneAuthProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneAuthProvider.verifyPhoneNumber(
        {
          multiFactorHint: phoneHint,
          session: resolver.session
        },
        appVerifier
      );

      return {
        mfaChallenge: {
          resolver,
          verificationId,
          phoneHint
        }
      };
    }
    throw error;
  }
}

/**
 * Completes sign in using the SMS verification code received on the user's enrolled phone.
 */
export async function resolveMfaSignIn(
  resolver: MultiFactorResolver,
  verificationId: string,
  verificationCode: string
): Promise<User> {
  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const assertion = PhoneMultiFactorGenerator.assertion(cred);
  const result = await resolver.resolveSignIn(assertion);
  return result.user;
}

/**
 * Register a new user with email and password.
 */
export async function registerUser(email: string, pass: string): Promise<User> {
  const auth = getFirebaseAuth();
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

/**
 * Start enrolling a phone number as a second factor for the currently logged-in user.
 */
export async function startMfaEnrollment(
  phoneNumber: string,
  appVerifier: RecaptchaVerifier
): Promise<string> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No authenticated user found for MFA enrollment.");
  }

  const session = await multiFactor(user).getSession();
  const phoneAuthProvider = new PhoneAuthProvider(auth);
  const verificationId = await phoneAuthProvider.verifyPhoneNumber(
    {
      phoneNumber,
      session
    },
    appVerifier
  );

  return verificationId;
}

/**
 * Complete MFA enrollment using the SMS verification code.
 */
export async function confirmMfaEnrollment(
  verificationId: string,
  verificationCode: string,
  displayName = "Personal Mobile"
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No authenticated user found for MFA enrollment confirmation.");
  }

  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const assertion = PhoneMultiFactorGenerator.assertion(cred);
  await multiFactor(user).enroll(assertion, displayName);
}

/**
 * Sign out current user.
 */
export async function signOutCurrentUser(): Promise<void> {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/**
 * Subscribe to auth state changes.
 */
export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}
