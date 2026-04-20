
Update `capacitor.config.ts` so Xcode loads the current project instead of the old `violet-key-login` app.

## Changes to `capacitor.config.ts`

- `appId`: `app.lovable.ff3b6bc4afe44d498f17a01aa6a30a64`
- `appName`: `aura-key-login`
- `server.url`: `https://ff3b6bc4-afe4-4d49-8f17-a01aa6a30a64.lovableproject.com?forceHideBadge=true`
- Keep `webDir: 'dist'` and `server.cleartext: true`

Note: current `appId` is `app.sentinel.analytics`. If you've already shipped to TestFlight/App Store under that bundle ID, say so and I'll keep it — only `server.url` strictly must change to fix the "old version in Xcode" issue.

## After I push this, you must run locally

```
git pull
npm install
npm run build
npx cap sync ios
```

Then re-run from Xcode. Without `cap sync`, Xcode keeps the stale config baked into the iOS project and will keep loading the old URL.

## Verification I will do

- Re-read `capacitor.config.ts` after the edit and paste the new `server.url` and `appId` so you can confirm they match this project.

Note: this is a local config file — there's no DB row or edge function endpoint to curl for this change.
