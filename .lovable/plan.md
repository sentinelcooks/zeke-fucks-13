
Update `src/pages/GamesPage.tsx` only.

Change the UFC `FighterAvatar` wrapper from `w-11 h-11 rounded-full` to a 36px circle so both fighter avatars are smaller and no longer overlap the bell:
- width: 36px
- height: 36px
- border-radius: 50% (keep `rounded-full`)

Implementation scope:
- Edit the avatar container class in `FighterAvatar`
- Do not change spacing, z-index, margins, bell position, image scaling, or anything else

Expected result:
- Fighter 1 and Fighter 2 avatars render at 36×36
- Bell remains fully tappable and unobscured
- No other UI changes on the Games page
