# AlgoCommit — Architecture & Edge Cases Solved (v1.1.0)

This document tracks the most significant engineering challenges, logic flaws, and edge cases we encountered during the development of AlgoCommit v1.1.0, ordered by severity and architectural impact.

---

## 1. 🚨 The "Cloud Stats Wipe" Data-Loss Bug (CRITICAL)
**The Problem:** 
When a user switched their target repository in the UI, we intended to wipe their *local* browser cache so older stats wouldn't bleed over. However, the exact command used (`RESET_CLOUD_STATS`) was unintentionally pushing an empty `stats.json` to the *new* repository. If a user connected an existing AlgoCommit repository that already had 500 solved problems, the extension would permanently overwrite their remote `stats.json` and destroy their history.

**How We Handled It:**
We rewrote the `updateRepoData` lifecycle to clear `chrome.storage.local` instantly, but replaced the destructive cloud wipe with a secure `FETCH_CLOUD_STATS` command. The background script securely downloads the `stats.json` from the newly linked repository and seamlessly hydrates the browser UI, restoring all 500 problems without touching the remote file.

## 2. 🔐 Exposing the GitHub OAuth `CLIENT_SECRET`
**The Problem:**
To implement a smooth "one-click" login, we needed to use the GitHub OAuth Web App Flow. However, completing an OAuth exchange strictly requires passing a private `CLIENT_SECRET` key to GitHub. Chrome extensions are entirely client-side (frontend) code, meaning if we hardcoded the secret into `background.js`, any user could extract it by inspecting the extension source code.

**How We Handled It:**
We completely decoupled the authentication logic. We built a stateless **Vercel Serverless Backend** (`/api/exchange.js`) that securely holds the `CLIENT_SECRET` in environment variables. The Chrome Extension requests an authorization code, passes it to Vercel, and Vercel safely negotiates the `access_token` from GitHub and hands it back to the browser.

## 3. 👻 Codeforces "Silent Failure" on Network Interceptions
**The Problem:**
Competitive programming platforms frequently rotate backend API endpoints or use highly customized IDE plugins. Trying to intercept the raw `POST /submit/` network call for Codeforces was leading to silent failures, race conditions, or bad payloads.

**How We Handled It:**
Instead of fighting the volatile network layer, we used the highly stable UI structure. We built a `MutationObserver` in `content_scripts/codeforces.js` that watches the `table.status-frame-datatable`. When a row turns green (`<span class="verdict-accepted">`), the extension dynamically fetches the raw source code URL provided in the table, parses it from `<pre id="program-source-text">`, and funnels it into the pushing pipeline.

## 4. 🪦 The "Dead Repository" 404 Silent Drop
**The Problem:**
If a user created and linked a repository (e.g. `My-DSA-Repo`), but then manually deleted it or renamed it on `GitHub.com`, the extension would sit in a silent failure loop. Every time they solved a problem, the GitHub API would return a `404 Not Found` error in the background script, but the user would never realize their code wasn't saving.

**How We Handled It:**
We explicitly updated `manifest.json` to include the `notifications` permission. We wrapped the `handleSyncProblem` push logic in a strict `try/catch` block. If the API returns a `Not Found` error, the extension spawns a native Windows/macOS desktop alert explicitly warning the user: *"AlgoCommit could not find your GitHub repository. Was it deleted or renamed?"*

## 5. 🧱 UX Friction: The "Missing Repo" Lockout
**The Problem:**
When users typed in a repository name during setup, if it didn't exist, the UI simply threw an angry red error: "Repository not found. Please create it first." This forced users to manually log out, open GitHub, create the repo, and log back in, creating massive drop-off friction.

**How We Handled It:**
We built a dynamic inline recovery state across the entire UI. If the GitHub API returns a 404 during setup or settings-modification, the UI swaps out the "Save" button for a green **"Create + Link '[RepoName]' Now"** button. Clicking it hits `"POST /user/repos"`, generating a public repository initialized with a README (`auto_init: true`) and instantly mapping the user without a single page reload.

## 6. 🌐 Cross-Origin CORS Blocking on Fetch
**The Problem:**
When scraping the geeksforgeeks UI, or when verifying the repo on GitHub, trying to blindly call multiple random endpoints using native Chrome `fetch()` from isolated background scripts frequently generated strict Cross-Origin Resource Sharing (CORS) exceptions.

**How We Handled It:**
We explicitly whitelisted the structural domains (`https://leetcode.com/*`, `https://*.geeksforgeeks.org/*`, `https://codeforces.com/*`, `https://api.github.com/*`) directly inside the `manifest.json` under `host_permissions`. This gives `background.js` the elevated execution privileges required to proxy these API calls successfully.
