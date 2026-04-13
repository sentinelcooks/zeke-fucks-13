
-- Create profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  timezone text DEFAULT 'America/New_York',
  notification_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Add user_id to plays
ALTER TABLE public.plays ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update plays RLS
DROP POLICY IF EXISTS "Anyone can manage plays by license key" ON public.plays;
CREATE POLICY "Users can manage own plays" ON public.plays FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add user_id to pick_history
ALTER TABLE public.pick_history ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update pick_history RLS
DROP POLICY IF EXISTS "Users can delete own pick history" ON public.pick_history;
DROP POLICY IF EXISTS "Users can insert own pick history" ON public.pick_history;
DROP POLICY IF EXISTS "Users can read own pick history" ON public.pick_history;
CREATE POLICY "Users can read own pick history" ON public.pick_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pick history" ON public.pick_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own pick history" ON public.pick_history FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Push notification subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  endpoint text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own push subs" ON public.push_subscriptions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
