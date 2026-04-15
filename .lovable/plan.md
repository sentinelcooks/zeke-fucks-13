
Fix this in `src/pages/GamesPage.tsx` only.

What’s happening:
- The bell already has a higher z-index, but the UFC fighter row still starts too close to the top-right control area.
- So this is now a layout-clearance issue as much as a stacking issue: the right fighter avatar is occupying the same visual/tap zone as the bell.

Plan:
1. Keep the bell controls definitively on top
- Retain `z-10` on the top-right notification container.
- Add explicit `relative z-10 pointer-events-auto` to the bell button itself so the tap target is unquestionably above surrounding content.

2. Keep fighter avatars below
- Retain `relative z-[1]` on each `FighterAvatar` wrapper so avatars stay on a lower layer.

3. Create space so the bell is not physically overlapped
- Add top spacing to the UFC fighter grid/container so the fighter row sits below the bell area instead of directly under it.
- If needed, add a little right-side padding on that same row so the far-right avatar does not sit under the bell on narrow mobile widths.

4. Verify the fix against the current mobile layout
- Check the UFC cards at the current 390px-wide viewport.
- Confirm the bell is fully visible, not visually intersecting the right fighter headshot, and remains tappable on both main-event and standard fight cards.

Scope:
- Single file: `src/pages/GamesPage.tsx`
- No changes to other pages or shared components
- No changes to the bell behavior, only layering and spacing
