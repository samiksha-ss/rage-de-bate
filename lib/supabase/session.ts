import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

export async function ensureUser(supabase: SupabaseClient): Promise<User> {
  const { data: existing, error: existingError } = await supabase.auth.getUser();
  if (existingError) {
    throw existingError;
  }
  if (existing.user) {
    return existing.user;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error("sign_in_failed");
  }
  return data.user;
}

export async function loadProfile(supabase: SupabaseClient, userId: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, rating, wins, losses, draws, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (data) {
      return data as Profile;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

export function authErrorCopy(message: string) {
  if (/anonymous/i.test(message)) {
    return "Anonymous sign-in is off. Enable it in the Supabase dashboard.";
  }
  return "Could not sign in.";
}
