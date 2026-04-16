

## Plan: Auto-detect User's Timezone on Settings Page

### Problem
The timezone defaults to "America/New_York" regardless of the user's actual location. Users must manually find and select their timezone.

### Fix

**`src/pages/SettingsPage.tsx`** — Two changes:

1. **On first load (no saved timezone):** Use `Intl.DateTimeFormat().resolvedOptions().timeZone` to detect the browser/device timezone. If it matches one of the `TIMEZONES` entries, use it as the default and save it to the profile.

2. **Add an `useEffect` for auto-detection on mount:** When `profile?.timezone` is still the default `"America/New_York"` or missing, check the device timezone and auto-update the profile if it differs.

```typescript
// Inside SettingsPage component, after profile loads
useEffect(() => {
  if (!profile) return;
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const matchedTz = TIMEZONES.find((t) => t.value === deviceTz);
  
  // Auto-set if profile still has the default and device tz is different & supported
  if (matchedTz && profile.timezone === "America/New_York" && deviceTz !== "America/New_York") {
    handleTzChange(deviceTz);
  }
}, [profile?.id]); // Run once when profile first loads
```

**Also update the `AuthContext.tsx` profile creation fallback** — when creating a new profile (the upsert in `fetchProfile`), detect timezone there too:

```typescript
const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const { data: newProfile } = await supabase
  .from("profiles")
  .upsert({
    id: userId,
    email: currentUser.email,
    display_name: displayName,
    timezone: deviceTz || "America/New_York",
  }, { onConflict: "id" })
  .select()
  .single();
```

### Scope
- 2 files: `SettingsPage.tsx` (auto-detect on visit), `AuthContext.tsx` (set on signup)
- No database changes needed — timezone column already exists

