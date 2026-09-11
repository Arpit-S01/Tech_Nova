# Tech Nova onboarding

A three-stage account and competency onboarding flow, backed by a real
Express + SQLite API (see `server/`).

## Run it

Two processes, two terminals:

```bash
# Terminal 1 — backend (port 4000)
cd server
npm install
npm start

# Terminal 2 — frontend (port 3000)
npm install
npm start
```

Open `http://localhost:3000` when the frontend is ready. It talks to the
backend automatically via the `proxy` field in `package.json`.

The flow still stores account/profile/level in browser local storage for a
smooth reload experience, but the assessment itself — question generation,
grading, skill-gap detection, and course recommendations — is now handled by
the backend in `server/`. See `server/README.md` for API details and an
important note about the placeholder iGOT course links in `server/src/courses.js`.

The Google sign-in button is still an intentional visual placeholder — it
does not make a real sign-in request.

## Firebase authentication

Login/signup now goes through real Firebase Authentication (email/password
and Google). To run it:

1. Create a project at console.firebase.google.com.
2. Authentication → Sign-in method → enable **Email/Password** and **Google**.
3. Authentication → Settings → Authorized domains → add `localhost` (and your
   deployed domain later).
4. Project settings → General → Your apps → add a Web app → copy the config.
5. `cp .env.example .env.local` and paste those values in. `.env.local` is
   gitignored, so your keys won't be committed.
6. `npm install` (pulls in the `firebase` package) then `npm start`.

Without a valid `.env.local`, sign-in/sign-up will fail with a Firebase
"invalid API key" error — that's expected until you complete the steps above.

## Restricted job roles

The "Designation" and "Job role" fields on the profile step are locked
`<select>` dropdowns, not free text — a profile can only use designations and
functional roles that actually exist in India's Official Statistical System:
the Subordinate Statistical Service (SSS) and Indian Statistical Service
(ISS) cadre grades (Junior Statistical Officer → Director General), and NSSO
functional divisions (Field Operations, Data Processing, etc.). Sourced from
MoSPI/NSSO and the ISS cadre structure — see `src/App.js` (`profileOptions`)
to edit the list.
