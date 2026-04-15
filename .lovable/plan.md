

## Plan: Fix UFC Fighter Search Headshot Styling

### Problem
The fighter headshot thumbnails in the search dropdown look bad — they're square with `rounded-xl` and use `object-top` positioning, which crops faces poorly. The reference image shows circular headshots with proper face centering.

### Changes

**`src/pages/NbaPropsPage.tsx`** — Update both Fighter 1 and Fighter 2 dropdown headshot containers (lines ~972 and ~1040):

1. Change container from `w-11 h-11 rounded-xl` to `w-11 h-11 rounded-full` for circular shape
2. Change image from `object-cover object-top` to `object-cover object-center` for better face centering
3. Update the border style to match circular design (softer border)
4. Same changes apply to the fallback initials container

Both Fighter 1 (around line 972) and Fighter 2 (around line 1040) dropdowns need identical updates.

### Scope
- 1 file, 2 locations (~4 lines each)
- Purely cosmetic CSS changes

