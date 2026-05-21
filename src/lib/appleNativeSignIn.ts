import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

/**
 * Native Apple Sign In on iOS via @capacitor-community/apple-sign-in.
 *
 * Flow:
 *   1. Generate a cryptographically random raw nonce.
 *   2. SHA-256 hash it — Apple receives the hashed nonce (so it can be embedded
 *      in the signed identity token without ever revealing the raw value).
 *   3. Show the native Apple Sign In sheet (AuthenticationServices).
 *   4. Hand the returned identity token + the *raw* nonce to Supabase via
 *      signInWithIdToken. Supabase verifies the id_token's nonce claim against
 *      the SHA-256 of the raw nonce we pass.
 *   5. If Apple returned name fields on the first sign-in, persist them to
 *      user_metadata + profiles so the rest of the app picks them up.
 *
 * Only call this from iOS native. The web/Android path stays on the existing
 * supabase.auth.signInWithOAuth + Capacitor Browser fallback.
 */

export class AppleSignInCancelledError extends Error {
  constructor() {
    super("Apple sign-in was cancelled");
    this.name = "AppleSignInCancelledError";
  }
}

export function isAppleNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function generateRawNonce(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // URL-safe base64 (no padding) — matches what Apple/Supabase expect for nonces.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AppleAuthorizeResponse {
  response: {
    identityToken: string;
    authorizationCode?: string;
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    user?: string | null;
  };
}

/**
 * Native iOS Apple Sign In → Supabase session.
 *
 * Throws AppleSignInCancelledError when the user dismisses the sheet, and
 * a generic Error for any other failure (plugin missing, no identity token,
 * Supabase rejection, etc.).
 */
export async function signInWithAppleNative(opts: {
  /** iOS bundle identifier — must be allow-listed in Supabase Apple provider Client IDs. */
  clientId: string;
}): Promise<{ userId: string; isNewUser: boolean }> {
  if (!isAppleNativeAvailable()) {
    throw new Error("Native Apple sign-in is only available on iOS");
  }

  // Dynamic import so the bundle doesn't break on web where the plugin is absent.
  let SignInWithApple: typeof import("@capacitor-community/apple-sign-in").SignInWithApple;
  try {
    ({ SignInWithApple } = await import("@capacitor-community/apple-sign-in"));
  } catch (err) {
    throw new Error(
      "Apple Sign In plugin not installed. Run `npm install @capacitor-community/apple-sign-in && npx cap sync ios`."
    );
  }

  const rawNonce = generateRawNonce();
  const hashedNonce = await sha256Hex(rawNonce);

  let appleResult: AppleAuthorizeResponse;
  try {
    appleResult = (await SignInWithApple.authorize({
      clientId: opts.clientId,
      // redirectURI is required by the plugin's TS types but unused for native
      // sign-in (AuthenticationServices doesn't redirect).
      redirectURI: "",
      scopes: "email name",
      nonce: hashedNonce,
    })) as unknown as AppleAuthorizeResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The plugin surfaces user cancellation as code 1001 / "canceled" / "ASAuthorizationErrorCanceled".
    if (/cancel/i.test(msg) || /1001/.test(msg)) {
      throw new AppleSignInCancelledError();
    }
    throw new Error(msg || "Apple sign-in failed");
  }

  const identityToken = appleResult?.response?.identityToken;
  if (!identityToken) {
    throw new Error("Apple did not return an identity token");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce: rawNonce,
  });

  if (error || !data?.user) {
    throw new Error(error?.message || "Supabase rejected Apple identity token");
  }

  // Apple returns givenName/familyName ONLY on the first sign-in. If present,
  // persist them so the rest of the app (which reads display_name from
  // user_metadata + profiles) shows the user's real name.
  const given = appleResult.response.givenName?.trim() || "";
  const family = appleResult.response.familyName?.trim() || "";
  const fullName = [given, family].filter(Boolean).join(" ").trim();

  if (fullName) {
    const existingDisplayName =
      (data.user.user_metadata as { display_name?: string } | undefined)?.display_name?.trim() || "";
    if (!existingDisplayName) {
      // Best-effort — don't fail the sign-in if this errors.
      try {
        await supabase.auth.updateUser({
          data: {
            display_name: fullName,
            given_name: given || undefined,
            family_name: family || undefined,
          },
        });
        await supabase
          .from("profiles")
          .update({ display_name: fullName } as never)
          .eq("id", data.user.id);
      } catch {
        /* no-op */
      }
    }
  }

  // Determine "new user" by created_at vs last_sign_in_at proximity. Useful
  // for the caller if it wants to route through onboarding, but it's optional.
  const isNewUser =
    !!data.user.created_at &&
    !!data.user.last_sign_in_at &&
    Math.abs(
      new Date(data.user.created_at).getTime() -
        new Date(data.user.last_sign_in_at).getTime()
    ) < 5000;

  return { userId: data.user.id, isNewUser };
}
