import type { User } from "@supabase/supabase-js";

type ProfileLike =
  | { display_name?: string | null; email?: string | null }
  | null
  | undefined;

export function resolveDisplayName(
  profile: ProfileLike,
  user?: User | null,
  fallback = "User",
): string {
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile;
  const fromMetadata = (
    user?.user_metadata as { display_name?: string } | undefined
  )?.display_name?.trim();
  if (fromMetadata) return fromMetadata;
  const email = profile?.email ?? user?.email ?? "";
  const prefix = email.split("@")[0];
  return prefix || fallback;
}
