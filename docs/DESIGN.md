# ChudLog design direction

The owner requested an “expensive” theme with exaggerated UI/UX on 2026-10-15, replacing the first minimalist foundation. The direction is luxury performance equipment: blackened metal, cold chrome, controlled ember lighting, oversized condensed type, and tactile interactions.

## Source and precedence

The owner previously requested [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill). Its art-direction and redesign guidance informs the visual hierarchy and auth composition. This is a custom product interface, so marketing-page layout rules are adapted to actual app tasks. The owner's newer request overrides the earlier minimalism, system-font-only styling, and strict flat-surface treatment. Routes, primary navigation labels, consent text, account data, scoring rules, and fixed WIB calendar are preserved.

Design dials: variance 8, motion 7, density 6. These express the intended richness; they do not imply continuous motion on every surface.

## Audit and changes

The first shell used a uniform card stack, system type, and one generic layout for profiles, authentication, and tracker placeholders. The redesign gives each task a deliberate composition while retaining the six navigation destinations.

- Desktop: fixed workspace rail, account bar, asymmetric hero, three tracker plates, and supporting streak/rank panels.
- Mobile: compact identity bar, reflowed hero, full-width tracker controls, and a floating six-item navigation dock.
- Authentication: editorial display headline, decorative rank sculpture, three explicit sign-in/join/create modes, password visibility control, and expandable privacy details with required consent.
- Group: sculpted membership artwork, private invitation code, copy action, and confirmed/error feedback.
- Profile: identity panel and separate editable owner fields with visible derived protein goal.
- Rank details: native modal dialog with real thresholds, current rank, keyboard focus handling, Escape dismissal, and backdrop dismissal.

## Tokens and assets

| Role | Value |
| --- | --- |
| Canvas | `#0B0C0E` |
| Surface | `#131518` |
| Raised surface | `#1B1E22` |
| Structural line | `#2A2C30` |
| Primary text | `#F1F2F3` |
| Secondary text | `#999CA3` |
| Ember accent | `#FF7B29` |
| Display type | Barlow Condensed, 600/700/800 |
| Body type | Manrope, 400/500/600/700 |
| Cards | 12–15px radii |
| Inputs and buttons | 7–8px radii, at least 44px interactive height |
| Navigation icons | Phosphor, consistent duotone treatment |

Fonts ship locally through Fontsource packages; there are no runtime third-party font requests. The rank sculpture is original CSS geometry, beveled lighting, orbital markings, and a rank numeral. Metallic gradient treatments express material rather than introducing additional accent colors. No stock photos or generated bitmap assets are used.

## Interaction and accessibility

Tracker plates lift and illuminate on hover, primary controls respond on press, and the rank sculpture changes perspective on hover. Page/section entrances use opacity and transforms. Reduced-motion preference disables entrances and transitions. Reduced-transparency preference gives the dock and modal backdrop solid fallbacks.

The modal uses native dialog semantics. Inputs retain visible labels, the password has an explicit accessible name, avatar-only navigation remains named, and keyboard focus and a skip link are available. The countdown uses a local minute clock and never polls the API. No celebratory scores, logs, or streaks are fabricated.

## Functional surfaces

The design extends across live food, sleep, gym, statistics, routines, strength references, import, group, and profile workflows. Original SVG flames express seven streak tiers; rank materials express progression without inventing points. Charts use recorded working sets and show empty states when data is absent.

Writes show pending, confirmed, and failed states. Offline drafts remain visibly pending until server confirmation. Guided gym mode presents one exercise at a time while retaining the complete session draft. The app uses native form controls and a persistent mobile dock; decoration yields space to editing and history on small screens.
