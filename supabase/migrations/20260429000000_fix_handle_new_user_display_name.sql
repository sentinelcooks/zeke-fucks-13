-- Fix: persist signup display_name into profiles row.
-- Previously the handle_new_user trigger only inserted (id, email), so the
-- username supplied via supabase.auth.signUp options.data.display_name was
-- never written to public.profiles, and UI fell back to the email prefix.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    new.email,
    NULLIF(new.raw_user_meta_data->>'display_name', '')
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
        email        = COALESCE(public.profiles.email,        EXCLUDED.email);
  RETURN new;
END;
$$;

-- Backfill existing users whose profiles.display_name is NULL but who supplied
-- a display_name during signup (stored in auth.users.raw_user_meta_data).
UPDATE public.profiles p
SET display_name = NULLIF(u.raw_user_meta_data->>'display_name', '')
FROM auth.users u
WHERE p.id = u.id
  AND p.display_name IS NULL
  AND NULLIF(u.raw_user_meta_data->>'display_name', '') IS NOT NULL;
