// Background script for AlgoCommit Chrome Extension
import { fetchStatsFromGitHub, pushStatsToGitHub, atomicCommit } from '../utils/github.js';

// ── Daily Streak Reminder Alarm ───────────────────────────────────────────────

function scheduleDailyReminder() {
  chrome.storage.sync.get(['reminderTime'], (result) => {
    const timeStr = result?.reminderTime || '21:00';
    const [hours, minutes] = timeStr.split(':').map(Number);

    chrome.alarms.get('streak-reminder', (existing) => {
      if (existing) chrome.alarms.clear('streak-reminder');
      const now = new Date();
      const nextFire = new Date();
      nextFire.setHours(hours, minutes, 0, 0);
      if (nextFire <= now) nextFire.setDate(nextFire.getDate() + 1);
      const delayMs = nextFire.getTime() - now.getTime();
      chrome.alarms.create('streak-reminder', {
        delayInMinutes: delayMs / 60000,
        periodInMinutes: 24 * 60,
      });
      console.log(`[AlgoCommit] Streak reminder scheduled for ${timeStr} daily.`);
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'streak-reminder') return;

  try {
    const result = await new Promise(resolve => chrome.storage.sync.get(['streak'], resolve));
    const streak = result?.streak;
    const today = new Date().toLocaleDateString('en-CA');

    // Only notify if user hasn't solved anything today
    if (!streak || streak.lastSyncDate !== today || (streak.todayCount || 0) === 0) {
      const currentStreak = streak?.count || 0;
      const message = currentStreak > 0
        ? `You're on a 🔥 ${currentStreak}-day streak! Solve 1 problem to keep it alive.`
        : `Start your streak today! Solve 1 problem and begin your journey. 💪`;

      chrome.notifications.create('streak-reminder', {
        type: 'basic',
        iconUrl: 'Myicon.png',
        title: 'AlgoCommit — Daily Reminder',
        message,
        priority: 1,
      });
    }
  } catch (e) {
    console.error('[AlgoCommit] Failed to send streak notification:', e);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("AlgoCommit installed.");
  // Initialize storage if empty
  chrome.storage.local.get(["syncedProblems"], (result) => {
    if (!result.syncedProblems) chrome.storage.local.set({ syncedProblems: {} });
  });
  // Use Sync storage for streaks so it persists across installs/machines
  chrome.storage.sync.get(["streak"], (result) => {
    if (!result.streak) chrome.storage.sync.set({ streak: { count: 0, maxStreak: 0, todayCount: 0, lastSyncDate: null } });
  });
  scheduleDailyReminder();
});

// Re-schedule on browser startup (service workers can restart)
chrome.runtime.onStartup.addListener(() => {
  scheduleDailyReminder();
});

const getStorageValues = (keys) => {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
};

// Backward compat: convert old array format to object map.
// Old: ["LeetCode_Two_Sum"] → New: { "LeetCode_Two_Sum": true }
function normalizeSyncedProblems(synced) {
  if (!synced) return {};
  if (Array.isArray(synced)) {
    const obj = {};
    for (const id of synced) obj[id] = true;
    return obj;
  }
  return synced; // Already an object
}

// Compute the "effective" streak for display purposes.
// If the user hasn't solved anything today or yesterday, their streak has broken.
function computeEffectiveStreak(stats) {
  if (!stats || !stats.lastSyncDate) return { currentStreak: 0, todayCount: 0 };
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA');

  if (stats.lastSyncDate === today) {
    // Solved today — streak is live
    return { currentStreak: stats.currentStreak || 0, todayCount: stats.todayCount || 0 };
  } else if (stats.lastSyncDate === yesterdayStr) {
    // Solved yesterday but not today — streak is still alive, todayCount resets
    return { currentStreak: stats.currentStreak || 0, todayCount: 0 };
  } else {
    // Skipped more than 1 day — streak is broken
    return { currentStreak: 0, todayCount: 0 };
  }
}

// ── OAuth Configuration ──────────────────────────────────────────────────────
// IMPORTANT: Replace these with your actual values after setup.
// CLIENT_ID is safe to be public. The secret stays on Vercel.
const GITHUB_CLIENT_ID = 'Ov23liQTtfXURSJJ2hU9';
const TOKEN_EXCHANGE_URL = 'https://algocommit-auth.vercel.app/api/exchange';

// Listener for messages from content scripts and popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SYNC_PROBLEM") {
    handleSyncProblem(request.payload, sendResponse);
    return true; // Keep message channel open for async response
  }
  if (request.type === "LOGIN_GITHUB") {
    handleGitHubOAuth(sendResponse);
    return true;
  }
  if (request.type === "FETCH_CLOUD_STATS") {
    handleFetchCloudStats(sendResponse);
    return true;
  }
  if (request.type === "RESET_CLOUD_STATS") {
    handleResetCloudStats(sendResponse);
    return true;
  }
  if (request.type === "RESCHEDULE_ALARM") {
    scheduleDailyReminder();
    sendResponse({ status: 'ok' });
    return true;
  }
});

// GitHub OAuth — opens popup, exchanges code for token via Vercel
async function handleGitHubOAuth(sendResponse) {
  const redirectUri = chrome.identity.getRedirectURL();
  console.log('[AlgoCommit] OAuth redirect URI:', redirectUri);

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return sendResponse({
          status: 'error',
          message: chrome.runtime.lastError?.message || 'Authentication cancelled or failed'
        });
      }

      // Extract the code from the redirect URL
      const code = new URL(redirectUrl).searchParams.get('code');
      if (!code) {
        return sendResponse({ status: 'error', message: 'No authorization code returned.' });
      }

      try {
        // Exchange code for token via Vercel serverless function
        const tokenRes = await fetch(TOKEN_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          return sendResponse({ status: 'error', message: tokenData.error_description || 'Failed to obtain access token.' });
        }

        // Fetch GitHub username
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `token ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        await chrome.storage.local.set({
          githubToken: tokenData.access_token,
          githubUsername: userData.login
        });

        sendResponse({ status: 'success', username: userData.login });
      } catch (e) {
        sendResponse({ status: 'error', message: e.message });
      }
    }
  );
}

// Popup requests fresh stats from GitHub to hydrate the dashboard
async function handleFetchCloudStats(sendResponse) {
  try {
    const config = await getStorageValues(["githubToken", "githubRepo", "githubUsername"]);
    if (!config.githubToken || !config.githubRepo) {
      return sendResponse({ status: "skip", message: "Not configured yet." });
    }
    const { stats } = await fetchStatsFromGitHub(config.githubToken, config.githubUsername, config.githubRepo);
    if (stats) {
      // Compute effective streak (decays if user skipped days)
      const effective = computeEffectiveStreak(stats);

      // Mirror cloud stats into local cache with streak decay applied
      await chrome.storage.local.set({
        syncedProblems: normalizeSyncedProblems(stats.syncedProblems),
        difficultyCounts: stats.difficultyCounts || { easy: 0, medium: 0, hard: 0, basic: 0 },
        activityHistory: stats.activityHistory || {},
        todayProblems: stats.todayProblems || []
      });
      await chrome.storage.sync.set({
        streak: {
          count: effective.currentStreak,
          maxStreak: stats.maxStreak || 0,
          todayCount: effective.todayCount,
          lastSyncDate: stats.lastSyncDate || null
        }
      });
      // Return stats with effective (decayed) streak values for display
      sendResponse({ status: "success", stats: {
        ...stats,
        currentStreak: effective.currentStreak,
        todayCount: effective.todayCount
      }});
    } else {
      sendResponse({ status: "empty", message: "No stats.json found on GitHub yet." });
    }
  } catch (e) {
    console.error('[AlgoCommit] Failed to fetch cloud stats:', e);
    sendResponse({ status: "error", message: e.message });
  }
}

// Reset stats.json on GitHub when user clicks "Reset App Data"
async function handleResetCloudStats(sendResponse) {
  try {
    const config = await getStorageValues(["githubToken", "githubRepo", "githubUsername"]);
    if (!config.githubToken || !config.githubRepo) {
      return sendResponse({ status: "skip" });
    }
    const emptyStats = {
      totalSolved: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastSyncDate: null,
      todayCount: 0,
      difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 },
      syncedProblems: {},
      activityHistory: {}
    };
    // Fetch current sha so we can update (not create duplicate)
    const { sha } = await fetchStatsFromGitHub(config.githubToken, config.githubUsername, config.githubRepo);
    await pushStatsToGitHub(config.githubToken, config.githubUsername, config.githubRepo, emptyStats, sha);
    sendResponse({ status: "success" });
  } catch (e) {
    console.error('[AlgoCommit] Failed to reset cloud stats:', e);
    sendResponse({ status: "error", message: e.message });
  }
}

async function handleSyncProblem(payload, sendResponse) {
  try {
    const { platform, title, difficulty, description, language, code, url } = payload;
    const problemId = `${platform}_${title.replace(/\s+/g, '_')}`;
    const solvedAt = new Date();
    const dateStr = solvedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = solvedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    console.log(`[AlgoCommit] Syncing problem: ${title} from ${platform}`);

    // Get configuration
    const config = await getStorageValues(["githubToken", "githubRepo", "githubUsername", "syncedProblems"]);
    
    if (!config.githubToken || !config.githubRepo) {
        return sendResponse({ status: "error", message: "GitHub not configured. Please setup AlgoCommit." });
    }

    // Check if already synced
    const syncedProblems = normalizeSyncedProblems(config.syncedProblems);
    if (problemId in syncedProblems) {
        console.log(`[AlgoCommit] Problem already synced: ${title}`);
        return sendResponse({ status: "success", message: "Already synced." });
    }

    // ── Cloud-first stats update ──────────────────────────────────────────────
    // 1. Fetch current stats.json from GitHub (source of truth)
    const { stats: cloudStats } = await fetchStatsFromGitHub(
      config.githubToken, config.githubUsername, config.githubRepo
    );

    const stats = cloudStats || {
      totalSolved: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastSyncDate: null,
      todayCount: 0,
      difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 },
      syncedProblems: {},
      activityHistory: {}
    };

    // Backward compat: convert old array format to object
    stats.syncedProblems = normalizeSyncedProblems(stats.syncedProblems);

    // If the problem was already tracked in cloud stats, skip duplicate
    if (problemId in stats.syncedProblems) {
      console.log(`[AlgoCommit] Problem already in cloud stats: ${title}`);
      return sendResponse({ status: "success", message: "Already synced." });
    }

    // 2. Update stats in memory
    stats.syncedProblems[problemId] = true;
    stats.totalSolved = Object.keys(stats.syncedProblems).length;
    const prevTotal = stats.totalSolved - 1;

    // Milestone celebrations
    const MILESTONES = [
      { n: 500, rank: 'Tech Lead',   emoji: '🟣' },
      { n: 250, rank: 'Sr Developer', emoji: '🔵' },
      { n: 100, rank: 'Developer',   emoji: '🔵' },
      { n:  50, rank: 'Jr Developer', emoji: '🟢' },
      { n:  25, rank: 'Intern',       emoji: '⚪' },
      { n:  10, rank: 'Learner',      emoji: '⚪' },
    ];
    const hit = MILESTONES.find(m => prevTotal < m.n && stats.totalSolved >= m.n);
    if (hit) {
      chrome.notifications.create(`milestone-${hit.n}`, {
        type: 'basic',
        iconUrl: 'Myicon.png',
        title: `🎉 AlgoCommit Milestone!`,
        message: `You just crossed ${hit.n} problems solved! ${hit.emoji} Rank unlocked: ${hit.rank}. Keep grinding!`,
        priority: 2,
      });
    }

    const diffKey = (difficulty || 'basic').toLowerCase();
    if (!stats.difficultyCounts) stats.difficultyCounts = { easy: 0, medium: 0, hard: 0, basic: 0 };
    if (diffKey in stats.difficultyCounts) {
      stats.difficultyCounts[diffKey] += 1;
    } else {
      stats.difficultyCounts.basic += 1;
    }

    // Streak logic
    const today = new Date().toLocaleDateString('en-CA');
    if (stats.lastSyncDate === today) {
      stats.todayCount = (stats.todayCount || 0) + 1;
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA');
      stats.currentStreak = (stats.lastSyncDate === yesterdayStr)
        ? (stats.currentStreak || 0) + 1
        : 1;
      stats.todayCount = 1;
      stats.lastSyncDate = today;
    }
    if (!stats.maxStreak || stats.currentStreak > stats.maxStreak) {
      stats.maxStreak = stats.currentStreak;
    }

    // Activity History (Heatmap)
    if (!stats.activityHistory) stats.activityHistory = {};
    stats.activityHistory[today] = (stats.activityHistory[today] || 0) + 1;

    // Today's Problem Names (for social share)
    if (!stats.todayProblems || stats.lastSyncDate !== today) {
      stats.todayProblems = [];
    }
    if (!stats.todayProblems.includes(title)) {
      stats.todayProblems.push(title);
    }

    // 3. Push updated stats.json back to GitHub
    // Build root README content first (needs a GET, but no write yet)
    const { newReadmeContent } = await buildRootReadmeContent(
      config, title, url, platform, difficulty, dateStr, timeStr
    );

    // 4. Create all files in a single atomic commit
    const basePath = `${platform}/${difficulty}/${title}`;
    const fileExtension = getFileExtension(language);
    const problemLink = url ? `[View Problem](${url})` : '';
    const readmeContent = `# ${title}\n\n## Difficulty: ${difficulty}\n\n## Platform: ${platform}\n\n${problemLink ? `## Problem Link\n${problemLink}\n\n` : ''}## Solved On\n${dateStr} at ${timeStr}\n\n${description}`;

    await atomicCommit(
      config.githubToken,
      config.githubUsername,
      config.githubRepo,
      [
        { path: `${basePath}/README.md`,          content: readmeContent },
        { path: `${basePath}/solution${fileExtension}`, content: code },
        { path: 'stats.json',                     content: JSON.stringify(stats, null, 2) },
        ...(newReadmeContent ? [{ path: 'README.md', content: newReadmeContent }] : []),
      ],
      `[AlgoCommit] ${platform}/${difficulty}/${title}`
    );

    // 5. Mirror to chrome.storage as local cache (for instant popup load)
    await chrome.storage.local.set({
      syncedProblems: stats.syncedProblems,
      difficultyCounts: stats.difficultyCounts,
      activityHistory: stats.activityHistory,
      todayProblems: stats.todayProblems || []
    });
    await chrome.storage.sync.set({
      streak: {
        count: stats.currentStreak,
        maxStreak: stats.maxStreak,
        todayCount: stats.todayCount,
        lastSyncDate: stats.lastSyncDate
      }
    });

    console.log(`[AlgoCommit] Successfully synced ${title}! Streak: ${stats.currentStreak}`);
    sendResponse({ status: "success", message: "Synced successfully!", streak: stats });

  } catch (error) {
      console.error("[AlgoCommit] Sync Error:", error);
      sendResponse({ status: "error", message: error.message });
  }
}

// Returns the new root README.md content string (does NOT write to GitHub)
// The actual write is bundled inside atomicCommit alongside the solution files.
async function buildRootReadmeContent(config, title, url, platform, difficulty, dateStr, timeStr) {
  const TABLE_HEADER = `| # | Problem | Platform | Difficulty | Date Solved | Time |\n|---|---------|----------|------------|-------------|------|`;
  const filePath = 'README.md';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${config.githubUsername}/${config.githubRepo}/contents/${filePath}`,
      { headers: { Authorization: `token ${config.githubToken}`, Accept: 'application/vnd.github.v3+json' } }
    );

    let existingContent = '';
    if (res.ok) {
      const data = await res.json();
      existingContent = atob(data.content.replace(/\n/g, ''));
    }

    const rowMatches = existingContent.match(/^\| \d+/gm) || [];
    const nextNum = rowMatches.length + 1;
    const problemLink = url ? `[${title}](${url})` : title;
    const newRow = `| ${nextNum} | ${problemLink} | ${platform} | ${difficulty} | ${dateStr} | ${timeStr} |`;

    let newContent;
    if (!existingContent.includes(TABLE_HEADER)) {
      newContent = `${TABLE_HEADER}\n${newRow}\n`;
    } else {
      newContent = existingContent.trimEnd() + '\n' + newRow + '\n';
    }
    return { newReadmeContent: newContent };
  } catch (e) {
    console.error('[AlgoCommit] Failed to build root README content:', e);
    return { newReadmeContent: null };
  }
}

function getFileExtension(language) {
    if (!language) return '.txt'; // Guard against null/undefined language
    const map = {
        'python': '.py',
        'python3': '.py',
        'java': '.java',
        'cpp': '.cpp',
        'c++': '.cpp',
        'c': '.c',
        'javascript': '.js',
        'js': '.js',
        'typescript': '.ts',
        'go': '.go',
        'rust': '.rs',
        'ruby': '.rb'
    };
    return map[language.toLowerCase()] || '.txt';
}

// Listen for submit requests to LeetCode
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Check if it's a POST request to submit the code
    if (
      details.method === 'POST' &&
      details.url.startsWith('https://leetcode.com/problems/') &&
      details.url.includes('/submit/')
    ) {
      const match = details.url.match(/\/problems\/(.*?)\/submit/);
      const questionSlug = match ? match[1] : null;
      
      if (!questionSlug) return;
      
      // Wait 3 seconds to ensure LeetCode backend processes the submission
      setTimeout(() => {
        chrome.tabs.sendMessage(details.tabId, { type: 'GET_LEETCODE_SUBMISSION', questionSlug });
      }, 3000);
    }
  },
  {
    urls: ['https://leetcode.com/problems/*/submit/'],
    types: ['xmlhttprequest'],
  }
);
