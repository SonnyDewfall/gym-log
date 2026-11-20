# Gym Log

A small workout logger that runs in the phone's browser and can be added to the home screen. It needs no server and no subscription.

- **Programme:** workouts grouped by day, with several variations of each to pick from.
- **Logging:** a one-tap "Did it" button, or enter your own weight and reps for each set. Each exercise has a notes box, and a rest timer starts when you tick a set.
- **Offline:** everything saves on the phone first, so the app works with no signal.
- **Google Drive sync:** your data is a single file, `Gym Log data.json`, in your own Drive. Any tool with access to your Drive, Claude included, can read and edit it.

## Setup

1. **Hosting:** repo Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`. The app is then at `https://sonnydewfall.github.io/gym-log/`.
2. **Drive sync (optional):** create an OAuth Client ID in Google Cloud and paste it into `config.js`. Steps:
   - At console.cloud.google.com, create a project called "Gym Log".
   - APIs & Services → Library → turn on **Google Drive API**.
   - OAuth consent screen → External. Enter an app name and your email, and add yourself as a **test user**.
   - Credentials → Create credentials → OAuth client ID → **Web application**. Under Authorised JavaScript origins, add `https://sonnydewfall.github.io`.
   - Copy the Client ID into `config.js`.

The app only asks for the `drive.file` permission, which limits it to the file it creates.

## Data file format (for editing by hand or by Claude)

```json
{
  "schema": 1,
  "workouts": { "<id>": { "day": 1, "order": 1, "name": "...", "variant": "Week 1 · Baseline", "warmup": "...",
                          "exercises": [ { "name": "...", "sets": 3, "repMin": 8, "repMax": 10, "unit": "reps|secs",
                                           "perSide": true, "weight": 12, "rest": 60, "group": "A|null", "cue": "..." } ],
                          "updatedAt": 1794817661000 } },
  "sessions": { "<id>": { "workoutId": "...", "workoutName": "...", "variant": "...", "day": 3, "date": "2026-11-16",
                          "startedAt": 0, "finishedAt": 0, "note": "...",
                          "exercises": [ { "name": "...", "group": null, "unit": "reps", "sets": [ { "w": 12, "r": 10, "done": true } ],
                                           "note": "...", "repMin": 8, "repMax": 10, "weight": 12, "rest": 60, "cue": "" } ],
                          "updatedAt": 1794817661000 } }
}
```

**Rules for editing:**
- `updatedAt` is in milliseconds. A record you change must have a newer `updatedAt` than the phone's copy, or the phone's copy wins at the next sync.
- To delete a record, replace it with `{"deleted": true, "updatedAt": <now>}`.
- Exercises that share a `group` letter, one after another, are done as a superset. The rest timer runs only after the last exercise in the group.

## Workouts from Claude (`inbox.json`)

Claude publishes new or changed workouts to `inbox.json` in this repo. The app reads it every time it opens and merges it in by `updatedAt`, so an edit you make later in the app is kept. The file holds workouts only, never sessions. Use `"day": 0` for custom one-off sessions; they're listed under "Custom sessions".
