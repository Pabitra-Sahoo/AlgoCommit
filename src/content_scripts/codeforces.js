// solve-sync/src/content_scripts/codeforces.js
console.log("[AlgoCommit] Codeforces sync script injected.");

let lastSubmissionId = 0;

chrome.storage.local.get(['codeforcesLastSubId'], (result) => {
    lastSubmissionId = result.codeforcesLastSubId || 0;
    startObserving();
});

function startObserving() {
    // Codeforces frequently updates the status table via AJAX.
    // We observe the DOM for changes, but also poll it periodically.
    setInterval(checkSubmissions, 2000);
    // Also check immediately on load
    checkSubmissions();
}

async function checkSubmissions() {
    // The standard table containing submissions has the class 'status-frame-datatable'
    // Rows with submissions always have the 'data-submission-id' attribute
    const rows = document.querySelectorAll('table.status-frame-datatable tr[data-submission-id]');
    if (!rows || rows.length === 0) return;

    // Convert to Array and sort by ID descending (newest first)
    const submissions = Array.from(rows).map(row => {
        return {
            row,
            id: parseInt(row.getAttribute('data-submission-id'), 10)
        };
    }).sort((a, b) => b.id - a.id);

    let newMaxId = lastSubmissionId;

    for (const sub of submissions) {
        if (sub.id <= lastSubmissionId) continue; // Already processed

        const row = sub.row;
        
        // CF Verdicts: Accepted, Wrong answer, Time limit exceeded, etc.
        // It's wrapped in a span, e.g., <span class="verdict-accepted">
        const verdictEl = row.querySelector('.verdict-accepted');
        
        if (verdictEl) {
            // New Accepted Submission!
            console.log(`[AlgoCommit] Found new Accepted submission: ${sub.id}`);
            await processSubmission(row, sub.id);
            newMaxId = Math.max(newMaxId, sub.id);
        } else {
            // Is it completely judged but failed? Or still running?
            // "In queue", "Running on test X" usually lacks verdict-* classes, 
            // but let's check text content just to be sure.
            const verdictCell = row.querySelector('.status-verdict-cell');
            if (verdictCell) {
                const text = verdictCell.textContent.toLowerCase();
                if (text.includes('queue') || text.includes('running') || text.trim() === '') {
                    // Still judging, do NOT mark as seen yet. We will catch it on the next interval.
                } else {
                    // It's a final verdict (Wrong answer, TLE, etc.) - mark as seen so we don't process it again
                    newMaxId = Math.max(newMaxId, sub.id);
                }
            }
        }
    }

    if (newMaxId > lastSubmissionId) {
        lastSubmissionId = newMaxId;
        chrome.storage.local.set({ codeforcesLastSubId: lastSubmissionId });
    }
}

async function processSubmission(row, subId) {
    try {
        // 1. Extract Problem Info
        // Typically the 3rd or 4th <td> contains the problem link: <a href="/contest/123/problem/A">
        const problemLinkEl = row.querySelector('td a[href*="/problem/"]');
        if (!problemLinkEl) throw new Error("Could not find problem link in row");
        
        // URL is relative, need absolute
        const problemUrl = new URL(problemLinkEl.getAttribute('href'), window.location.origin).href;
        // Text is usually like "A - Problem Title"
        const problemTitle = problemLinkEl.textContent.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '');

        // 2. Extract Language
        // Typically the 4th/5th <td>. We can grab all TDs and look for it.
        const tds = row.querySelectorAll('td');
        let language = 'cpp'; // fallback
        if (tds.length >= 5) {
            // Language is usually right before the verdict cell
            language = tds[4].textContent.trim();
        }

        // 3. Extract the Source Code
        // CF status table has an anchor to view the code on the ID cell itself
        const submissionLinkEl = row.querySelector('a.view-source');
        if (!submissionLinkEl) throw new Error("Could not find view-source link in row");
        
        const submissionUrl = new URL(submissionLinkEl.getAttribute('href'), window.location.origin).href;
        console.log(`[AlgoCommit] Fetching code from: ${submissionUrl}`);
        
        const code = await fetchCode(submissionUrl);
        if (!code) throw new Error("Failed to extract code from submission page");

        // 4. Send to Background Script to Push to GitHub
        chrome.runtime.sendMessage({
            type: "SYNC_PROBLEM",
            payload: {
                platform: "Codeforces",
                title: problemTitle,
                difficulty: "basic", // Codeforces difficulty is rating-based (e.g. 800), hard to scrape reliably from this row
                description: `## Codeforces Submission ID: ${subId}\n**Language:** ${language}`,
                language: language,
                code: code,
                url: problemUrl
            }
        });
    } catch (e) {
        console.error(`[AlgoCommit] Failed to sync Codeforces submission ${subId}:`, e.message);
    }
}

async function fetchCode(url) {
    try {
        // Fetch the HTML of the submission page
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // The code is inside a <pre id="program-source-text">
        const preEl = doc.getElementById('program-source-text');
        if (preEl) {
            return preEl.textContent; // Returns raw code including newlines
        }
        return null;
    } catch (e) {
        return null;
    }
}
