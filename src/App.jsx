import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const _DEVELOPER = "Pabitra Sahoo"; // Internal Attribution
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [authMethod, setAuthMethod] = useState('oauth');
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [editingRepo, setEditingRepo] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [repoNotFound, setRepoNotFound] = useState(false);
  const [newRepoNotFound, setNewRepoNotFound] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [reminderTime, setReminderTime] = useState('21:00');

  useEffect(() => {
    // Load config from Chrome storage (instant, local cache)
    if (chrome && chrome.storage) {
      chrome.storage.local.get(
        ["githubToken", "githubUsername", "githubRepo", "syncedProblems", "difficultyCounts", "activityHistory", "todayProblems"],
        (localResult) => {
          chrome.storage.sync.get(["streak", "reminderTime"], (syncResult) => {
            setConfig({ ...localResult, ...syncResult });
            if (localResult.githubRepo) setRepo(localResult.githubRepo);
            if (syncResult.reminderTime) setReminderTime(syncResult.reminderTime);
            setLoading(false);
            console.log("AlgoCommit Engine v1.3.0 initialized.");

            // Silently refresh from GitHub cloud stats in the background
            if (localResult.githubToken && localResult.githubRepo && chrome.runtime) {
              setIsSyncing(true);
              chrome.runtime.sendMessage({ type: "FETCH_CLOUD_STATS" }, (response) => {
                setIsSyncing(false);
                if (chrome.runtime.lastError) return; // Extension context may be invalidated
                if (response && response.status === "success" && response.stats) {
                  const s = response.stats;
                  setConfig(prev => ({
                    ...prev,
                    syncedProblems: s.syncedProblems || prev?.syncedProblems || {},
                    difficultyCounts: s.difficultyCounts || prev?.difficultyCounts,
                    activityHistory: s.activityHistory || prev?.activityHistory || {},
                    todayProblems: s.todayProblems || prev?.todayProblems || [],
                    streak: {
                      count: s.currentStreak ?? prev?.streak?.count ?? 0,
                      maxStreak: s.maxStreak ?? prev?.streak?.maxStreak ?? 0,
                      todayCount: s.todayCount ?? prev?.streak?.todayCount ?? 0,
                      lastSyncDate: s.lastSyncDate ?? prev?.streak?.lastSyncDate ?? null
                    }
                  }));
                  setLastSyncedAt(new Date());
                }
              });
            }
          });
        }
      );

      // ── Live UI Update Fix ────────────────────────────────────────────────────
      // Re-read storage whenever the background script updates it after a sync.
      // This makes the popup reflect new stats instantly without reopening.
      const handleStorageChange = (changes, area) => {
        if (area !== 'local') return;
        const relevantKeys = ['syncedProblems', 'difficultyCounts', 'activityHistory', 'todayProblems'];
        const hasRelevantChange = relevantKeys.some(key => key in changes);
        if (!hasRelevantChange) return;

        chrome.storage.local.get(
          ["githubToken", "githubUsername", "githubRepo", "syncedProblems", "difficultyCounts", "activityHistory", "todayProblems"],
          (localResult) => {
            chrome.storage.sync.get(["streak", "reminderTime"], (syncResult) => {
              setConfig(prev => ({ ...prev, ...localResult, ...syncResult }));
              setLastSyncedAt(new Date());
            });
          }
        );
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
      // ─────────────────────────────────────────────────────────────────────────
    } else {
      // Mock for local dev
      setLoading(false);
    }
  }, []);


  const handlePatLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);
    
    if (!token) {
      setError('Please provide a PAT token.');
      setIsLoggingIn(false);
      return;
    }

    try {
      // Verify token and fetch username
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        throw new Error("Invalid GitHub Token. Please check your PAT.");
      }

      const data = await response.json();
      const fetchedUsername = data.login;

      if (chrome && chrome.storage) {
        await chrome.storage.local.set({ 
          githubToken: token,
          githubUsername: fetchedUsername
        });
      }
      setConfig((prev) => ({ 
        ...prev, 
        githubToken: token,
        githubUsername: fetchedUsername
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };
  const updateRepoData = async (newRepoName) => {
    if (config?.githubRepo === newRepoName) return; // No change needed

    setIsSyncing(true);

    if (chrome && chrome.storage) {
      await chrome.storage.local.set({ 
        githubRepo: newRepoName,
        syncedProblems: {}, 
        difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 },
        activityHistory: {}
      });
      await chrome.storage.sync.set({ streak: { count: 0, maxStreak: 0, todayCount: 0, lastSyncDate: null } });
    }
    
    setConfig((prev) => ({ 
      ...prev, 
      githubRepo: newRepoName,
      syncedProblems: {}, 
      difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 }, 
      activityHistory: {},
      streak: { count: 0, maxStreak: 0, todayCount: 0, lastSyncDate: null }
    }));
    setRepo(newRepoName);
    setLastSyncedAt(null);

    // Fetch stats for the newly linked repo
    if (chrome && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "FETCH_CLOUD_STATS" }, (response) => {
        setIsSyncing(false);
        if (chrome.runtime.lastError) return;
        if (response && response.status === "success" && response.stats) {
          const s = response.stats;
            setConfig(prev => ({
              ...prev,
              syncedProblems: s.syncedProblems || prev?.syncedProblems || {},
              difficultyCounts: s.difficultyCounts || prev?.difficultyCounts,
              activityHistory: s.activityHistory || prev?.activityHistory || {},
              todayProblems: s.todayProblems || prev?.todayProblems || [],
              streak: {
              count: s.currentStreak ?? prev?.streak?.count ?? 0,
              maxStreak: s.maxStreak ?? prev?.streak?.maxStreak ?? 0,
              todayCount: s.todayCount ?? prev?.streak?.todayCount ?? 0,
              lastSyncDate: s.lastSyncDate ?? prev?.streak?.lastSyncDate ?? null
            }
          }));
          setLastSyncedAt(new Date());
        }
      });
    } else {
      setIsSyncing(false);
    }
  };

  const handleSaveRepo = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);
    
    if (!repo) {
      setError('Please provide a repository name.');
      setIsLoggingIn(false);
      return;
    }

    try {
      // Verify that the repository exists on GitHub
      const response = await fetch(`https://api.github.com/repos/${config.githubUsername}/${repo}`, {
        headers: {
          Authorization: `token ${config.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          setRepoNotFound(true);
          setError(`Repository '${repo}' not found.`);
          return;
        }
        throw new Error("Failed to verify repository. Please check your token or spelling.");
      }

      setRepoNotFound(false);
      await updateRepoData(repo);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCreateRepo = async (targetRepo = repo) => {
    setIsLoggingIn(true);
    setError('');
    const repoName = typeof targetRepo === 'string' ? targetRepo : repo;
    
    try {
      const response = await fetch(`https://api.github.com/user/repos`, {
        method: 'POST',
        headers: {
          Authorization: `token ${config.githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: repoName,
          private: false,
          auto_init: true,
          description: "Auto-synced DSA solutions using AlgoCommit"
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || "Failed to create repository.");
      }

      // Success!
      setRepoNotFound(false);
      setNewRepoNotFound(false);
      await updateRepoData(repoName);
      if (editingRepo) {
        setEditingRepo(false);
      }
    } catch (err) {
      setError(`Creation failed: ${err.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const clearConfig = () => {
    if (chrome && chrome.storage) {
      chrome.storage.local.remove(["githubToken", "githubUsername", "githubRepo"]);
    }
    setConfig(prev => prev ? { ...prev, githubToken: null, githubUsername: null, githubRepo: null } : null);
    setToken('');
    setRepo('');
  };

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to completely disconnect from GitHub?")) {
      clearConfig();
      setShowSettings(false);
    }
  };

  const handleResetData = () => {
    if (window.confirm("WARNING: This will reset your streak and forget which problems you've synced in the past. Your GitHub code will remain safe. Proceed?")) {
      if (chrome && chrome.storage) {
        chrome.storage.local.set({ syncedProblems: {}, difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 }, activityHistory: {} });
        chrome.storage.sync.set({ streak: { count: 0, maxStreak: 0, todayCount: 0, lastSyncDate: null } });
      }
      // Also reset cloud stats.json on GitHub
      if (chrome && chrome.runtime) {
        chrome.runtime.sendMessage({ type: "RESET_CLOUD_STATS" }, () => {});
      }
      setConfig(prev => prev ? { ...prev, syncedProblems: {}, difficultyCounts: { easy: 0, medium: 0, hard: 0, basic: 0 }, activityHistory: {}, streak: { count: 0, maxStreak: 0, todayCount: 0, lastSyncDate: null } } : null);
      setShowSettings(false);
    }
  };

  const getPatLink = () => {
    const scopes = "repo,workflow";
    const desc = "AlgoCommit%20Extension";
    return `https://github.com/settings/tokens/new?scopes=${scopes}&description=${desc}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#141218]">
        <div className="w-10 h-10 rounded-full border-[4px] border-[#4A4458] border-t-[#D0BCFF] animate-spin"></div>
      </div>
    );
  }

  const isAuthenticated = !!config?.githubToken;
  const isFullyConfigured = isAuthenticated && !!config?.githubRepo;

  // Compute effective streak for display — decay if user skipped days
  const todayStr = new Date().toLocaleDateString('en-CA');
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA');

  const streakLastSync = config?.streak?.lastSyncDate;
  const rawStreak = config?.streak?.count || 0;

  let effectiveStreak, effectiveTodayCount;
  if (streakLastSync === todayStr) {
    effectiveStreak = rawStreak;
    effectiveTodayCount = config?.streak?.todayCount || 0;
  } else if (streakLastSync === yesterdayStr) {
    effectiveStreak = rawStreak;
    effectiveTodayCount = 0;
  } else {
    effectiveStreak = 0;
    effectiveTodayCount = 0;
  }

  // Compute Platform Analytics
  let lcCount = 0, gfgCount = 0, cfCount = 0;
  let totalSolved = 0;
  if (config?.syncedProblems) {
    const keys = Object.keys(config.syncedProblems);
    totalSolved = keys.length;
    lcCount = keys.filter(k => k.startsWith('LeetCode')).length;
    gfgCount = keys.filter(k => k.startsWith('GeeksForGeeks')).length;
    cfCount = keys.filter(k => k.startsWith('Codeforces')).length;
  }
  const totalPlatforms = lcCount + gfgCount + cfCount;
  const lcWidth = totalPlatforms > 0 ? (lcCount / totalPlatforms) * 100 : 0;
  const gfgWidth = totalPlatforms > 0 ? (gfgCount / totalPlatforms) * 100 : 0;
  const cfWidth = totalPlatforms > 0 ? (cfCount / totalPlatforms) * 100 : 0;

  // Compute Engineering Rank
  const monthTrophies = config?.streak?.monthTrophies || 0;
  let rankTitle = "Learner";
  let rankColor = "text-[#938F99]";
  
  if (monthTrophies >= 12) {
    rankTitle = "CEO";
    rankColor = "text-[#FFB4AB] drop-shadow-[0_0_8px_rgba(255,180,171,0.8)]";
  } else if (totalSolved >= 750) {
    rankTitle = "Manager";
    rankColor = "text-[#F9C74F] drop-shadow-[0_0_6px_rgba(249,199,79,0.7)]"; 
  } else if (totalSolved >= 500) {
    rankTitle = "Tech Lead";
    rankColor = "text-[#D0BCFF] drop-shadow-[0_0_5px_rgba(208,188,255,0.6)]"; 
  } else if (totalSolved >= 300) {
    rankTitle = "Sr Developer";
    rankColor = "text-[#1F8ACB]"; 
  } else if (totalSolved >= 150) {
    rankTitle = "Developer";
    rankColor = "text-[#A8C7FA]"; 
  } else if (totalSolved >= 75) {
    rankTitle = "Jr Developer";
    rankColor = "text-[#6DD58C]"; 
  } else if (totalSolved >= 25) {
    rankTitle = "Intern";
    rankColor = "text-[#CAC4D0]"; 
  }

  // Share Text
  const todayProblems = config?.todayProblems || [];
  const problemsLine = todayProblems.length > 0
    ? `\n\n📝 Today I solved:\n${todayProblems.map(p => `  • ${p.replace(/_/g, ' ')}`).join('\n')}`
    : '';
  const shareText = encodeURIComponent(`Just hit a 🔥 ${effectiveStreak}-Day coding streak and solved ${effectiveTodayCount} problem${effectiveTodayCount !== 1 ? 's' : ''} today!${problemsLine}\n\n✅ ${totalSolved} Total Solved  |  🛡️ ${rankTitle}\n\nAuto-synced to GitHub with AlgoCommit 🚀\n#Learninpublic #DSA #AlgoCommit #ProblemSolving`);
  const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}`;
  const linkedinUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${shareText}`;

  function formatRelativeTime(date) {
    if (!date) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }


  return (
    <div className="relative min-h-screen bg-[#141218] text-[#E6E1E5] font-sans overflow-x-hidden pt-16 pb-4 px-5">
      {/* Expressive Background Orbs */}
      <div className="fixed top-[-20%] left-[-20%] w-[350px] h-[350px] bg-[#D0BCFF] opacity-10 rounded-full blur-[80px] pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-20%] w-[350px] h-[350px] bg-[#F2B8B5] opacity-5 rounded-full blur-[80px] pointer-events-none"></div>

      {/* Top Navbar */}
      <div className="fixed top-0 left-0 right-0 h-16 bg-[#141218]/80 backdrop-blur-md border-b border-[#49454F]/20 z-50 flex items-center justify-between px-5 shadow-sm">
        <a 
          href="https://algocommit.netlify.app/" 
          target="_blank" 
          rel="noreferrer" 
          className="flex items-center space-x-3 group cursor-pointer no-underline"
          title="Visit our Website"
        >
          <div className="w-[32px] h-[32px] flex items-center justify-center transition-transform group-hover:scale-110 active:scale-95">
            <img src="/Myicon.png" alt="AlgoCommit Logo" className="w-full h-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
          </div>
          <h1 className="text-[18px] font-bold tracking-tight text-[#E6E1E5] group-hover:text-[#D0BCFF] transition-colors">
            AlgoCommit
          </h1>
        </a>
        
        {isFullyConfigured && (
          <div className="flex items-center gap-1.5">
            <div className="relative group/repo">
              <a 
                href={`https://github.com/${config?.githubUsername}/${config?.githubRepo}`}
                target="_blank"
                rel="noreferrer"
                className="relative z-10 cursor-pointer transition-colors p-[8px] rounded-full active:scale-95 flex items-center justify-center text-[#CAC4D0] hover:text-[#E6E1E5] hover:bg-[#49454F]/30"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-[20px] w-[20px]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
              <div className="absolute right-0 top-[110%] mt-1 w-max px-2.5 py-1.5 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[8px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/repo:opacity-100 group-hover/repo:visible transition-all duration-200 z-[100] text-center pointer-events-none">
                View Linked Repo
              </div>
            </div>

            <div className="relative group/settings">
              <button 
                onClick={() => setShowSettings(!showSettings)} 
                className={`relative z-10 cursor-pointer transition-colors p-[8px] rounded-full active:scale-95 flex items-center justify-center ${showSettings ? 'bg-[#4A4458] text-[#E8DEF8]' : 'text-[#CAC4D0] hover:text-[#E6E1E5] hover:bg-[#49454F]/30'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-[20px] w-[20px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            
            {!showSettings && (
              <div className="absolute right-0 top-[110%] mt-1 w-max px-2.5 py-1.5 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[8px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/settings:opacity-100 group-hover/settings:visible transition-all duration-200 z-[100] text-center pointer-events-none">
                Settings
              </div>
            )}
            
            {showSettings && (
              <div className="animate-slide-down absolute top-[120%] right-0 w-60 bg-[#2B2930] rounded-[16px] shadow-[0_8px_24px_rgba(0,0,0,0.6)] z-[60] border border-[#49454F]/50">
                <div className="p-1">
                  {/* Connected Repo Info */}
                  <div className="px-4 py-3 border-b border-[#49454F]/60 mb-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] font-bold text-[#938F99] uppercase tracking-widest">Connected Repo</p>
                      {!editingRepo && (
                        <div className="relative group flex">
                          <button
                            onClick={() => { setEditingRepo(true); setNewRepo(config?.githubRepo || ''); setError(''); }}
                            className="cursor-pointer text-[#CAC4D0] hover:text-[#E8DEF8] transition-colors p-0.5"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-[14px] w-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <div className="absolute right-0 bottom-full mb-1.5 w-[70px] px-2 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] text-center pointer-events-none">
                            Edit Repo
                          </div>
                        </div>
                      )}
                    </div>
                    {editingRepo ? (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={newRepo}
                          onChange={e => { setNewRepo(e.target.value); setNewRepoNotFound(false); setError(''); }}
                          className="w-full bg-[#141218] border border-[#938F99] rounded-[10px] px-3 py-2 text-[13px] text-[#E6E1E5] focus:outline-none focus:border-[#D0BCFF] focus:ring-1 focus:ring-[#D0BCFF] transition-all placeholder-[#938F99]/50"
                          placeholder="e.g. DSA-Solutions"
                          autoFocus
                        />
                        {error && <p className="text-[#F2B8B5] text-[11px] mt-1.5">{error}</p>}
                        <div className="flex flex-col gap-2 mt-2">
                          {!newRepoNotFound ? (
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (!newRepo.trim()) { setError('Repo name required'); return; }
                                  setError('');
                                  setIsLoggingIn(true);
                                  try {
                                    const res = await fetch(`https://api.github.com/repos/${config.githubUsername}/${newRepo.trim()}`, {
                                      headers: { Authorization: `token ${config.githubToken}`, Accept: 'application/vnd.github.v3+json' }
                                    });
                                    if (!res.ok) {
                                      if (res.status === 404) {
                                        setNewRepoNotFound(true);
                                        setError(`Repository '${newRepo.trim()}' not found.`);
                                        setIsLoggingIn(false);
                                        return;
                                      }
                                      throw new Error('Repo not found');
                                    }
                                    const trimmed = newRepo.trim();
                                    await updateRepoData(trimmed);
                                    setEditingRepo(false);
                                    setError('');
                                  } catch {
                                    setError('Repository not found. Check spelling.');
                                  } finally {
                                    setIsLoggingIn(false);
                                  }
                                }}
                                disabled={isLoggingIn}
                                className="flex-1 bg-[#D0BCFF] text-[#381E72] text-[12px] font-bold py-1.5 rounded-[8px] hover:bg-[#EADDFF] transition-colors active:scale-95 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                              >
                                {isLoggingIn ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingRepo(false); setError(''); setNewRepoNotFound(false); }}
                                className="flex-1 bg-[#49454F]/40 text-[#CAC4D0] text-[12px] font-bold py-1.5 rounded-[8px] hover:bg-[#49454F]/60 transition-colors active:scale-95 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleCreateRepo(newRepo.trim())}
                                disabled={isLoggingIn}
                                className="w-full bg-[#b8f5a6] text-[#0d3f00] text-[12px] font-bold py-1.5 rounded-[8px] hover:bg-[#cbfcb9] transition-colors active:scale-95 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                              >
                                {isLoggingIn ? 'Creating...' : `Create + Link '${newRepo.trim()}'`}
                              </button>
                              <button
                                onClick={() => { setNewRepoNotFound(false); setError(''); }}
                                className="w-full bg-transparent border border-[#938F99] text-[#CAC4D0] text-[12px] font-bold py-1.5 rounded-[8px] hover:bg-[#49454F] transition-colors active:scale-95 cursor-pointer disabled:cursor-not-allowed"
                              >
                                Try linking again
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[13px] font-bold text-[#D0BCFF] truncate">
                        {config?.githubUsername}/<span className="text-[#E6E1E5]">{config?.githubRepo}</span>
                      </p>
                    )}
                  </div>
                  {isFullyConfigured && lastSyncedAt && (
                    <div className="w-full flex items-center justify-center gap-1.5 px-4 pb-2 mb-1 border-b border-[#49454F]/60">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-[12px] w-[12px] text-[#938F99]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="text-[11px] text-[#938F99] font-medium">
                        Last synced: {formatRelativeTime(lastSyncedAt)}
                      </span>
                    </div>
                  )}
                  {/* Reminder Time Picker */}
                  <div className="px-4 py-2.5 border-b border-[#49454F]/60 mb-1">
                    <p className="text-[11px] font-bold text-[#938F99] uppercase tracking-widest mb-2">Daily Reminder</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={reminderTime}
                        onChange={e => setReminderTime(e.target.value)}
                        className="flex-1 bg-[#141218] border border-[#49454F] rounded-[8px] px-2 py-1 text-[12px] text-[#E6E1E5] focus:outline-none focus:border-[#D0BCFF] transition-all cursor-pointer"
                      />
                      <button
                        onClick={() => {
                          if (chrome && chrome.storage) {
                            chrome.storage.sync.set({ reminderTime });
                            chrome.runtime.sendMessage({ type: 'RESCHEDULE_ALARM' });
                          }
                        }}
                        className="px-3 py-1 bg-[#D0BCFF] text-[#381E72] text-[11px] font-bold rounded-[8px] hover:bg-[#EADDFF] active:scale-95 transition-all cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <button onClick={handleResetData} className="cursor-pointer w-full text-left px-4 py-3 text-[14px] text-[#F2B8B5] hover:bg-[#601410]/40 rounded-[12px] transition-colors flex items-center font-bold">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Reset App Data
                  </button>
                  <hr className="border-[#49454F] my-1 mx-2" />
                  <button onClick={handleLogout} className="cursor-pointer w-full text-left px-4 py-3 text-[14px] text-[#F2B8B5] hover:bg-[#601410]/40 rounded-[12px] transition-colors flex items-center font-bold pb-2.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Disconnect GitHub
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        )}
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-[360px] mx-auto pt-6">
        
        {!isAuthenticated && (
          <div className="w-full bg-[#211F26] rounded-[28px] p-7 shadow-xl border border-[#49454F]/20">
            <h2 className="text-[22px] font-semibold mb-2 text-[#E6E1E5]">Connect GitHub</h2>
            <p className="text-[14px] text-[#CAC4D0] mb-7 font-medium leading-[20px]">Authorize with GitHub to auto-sync your coding solutions.</p>
            
            <div className="flex bg-[#141218] p-1.5 rounded-full mb-7 border border-[#49454F]/40">
              <button 
                onClick={() => { setAuthMethod('oauth'); setError(''); }}
                className={`cursor-pointer flex-1 text-[14px] font-bold py-2 rounded-full transition-all ${authMethod === 'oauth' ? 'bg-[#4A4458] text-[#E8DEF8] shadow-md' : 'text-[#CAC4D0] hover:text-[#E6E1E5]'}`}
              >
                Quick Login
              </button>
              <button 
                onClick={() => { setAuthMethod('pat'); setError(''); }}
                className={`cursor-pointer flex-1 text-[14px] font-bold py-2 rounded-full transition-all ${authMethod === 'pat' ? 'bg-[#4A4458] text-[#E8DEF8] shadow-md' : 'text-[#CAC4D0] hover:text-[#E6E1E5]'}`}
              >
                Use Token
              </button>
            </div>

            {authMethod === 'oauth' ? (
              <div className="space-y-4">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    setError('');
                    setIsLoggingIn(true);
                    if (chrome && chrome.runtime) {
                      chrome.runtime.sendMessage({ type: 'LOGIN_GITHUB' }, (response) => {
                        setIsLoggingIn(false);
                        if (chrome.runtime.lastError) {
                          setError(chrome.runtime.lastError.message);
                          return;
                        }
                        if (response && response.status === 'success') {
                          chrome.storage.local.get(['githubToken', 'githubUsername'], (result) => {
                            setConfig(prev => ({ ...prev, ...result }));
                          });
                        } else {
                          setError(response?.message || 'Login failed');
                        }
                      });
                    } else {
                      setIsLoggingIn(false);
                      setError('Extension environment not found.');
                    }
                  }}
                  disabled={isLoggingIn}
                  className="cursor-pointer w-full bg-[#D0BCFF] hover:bg-[#EADDFF] text-[#381E72] font-bold py-[14px] px-6 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95 disabled:opacity-70 disabled:active:scale-100"
                >
                  {isLoggingIn ? (
                    <div className="w-5 h-5 border-[3px] border-t-transparent border-[#381E72] rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" className="w-[18px] h-[18px] mr-2" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                      </svg>
                      Login with GitHub
                    </>
                  )}
                </button>
                <p className="text-[11px] text-[#938F99] text-center">Opens GitHub in a popup — no token needed</p>
              </div>
            ) : (
              <form onSubmit={handlePatLogin} className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[13px] font-bold text-[#CAC4D0]">GitHub PAT Token</label>
                    <a href={getPatLink()} target="_blank" rel="noreferrer" className="text-[12px] font-bold text-[#D0BCFF] hover:text-[#EADDFF] transition-colors">
                      Get Token &rarr;
                    </a>
                  </div>
                  <input 
                    type="password" 
                    value={token} onChange={e => setToken(e.target.value)}
                    className="w-full bg-[#141218] border border-[#938F99] rounded-[16px] px-4 py-3.5 text-[15px] text-[#E6E1E5] focus:outline-none focus:border-[#D0BCFF] focus:ring-1 focus:ring-[#D0BCFF] transition-all placeholder-[#938F99]/50"
                    placeholder="ghp_xxxxxxxxxxxx"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full bg-[#D0BCFF] hover:bg-[#EADDFF] text-[#381E72] font-bold py-[14px] rounded-[100px] transition-all shadow-md active:scale-95 disabled:opacity-70 disabled:active:scale-100 cursor-pointer"
                >
                  {isLoggingIn ? 'Connecting...' : 'Connect with Token'}
                </button>
              </form>
            )}
            
            {error && <p className="text-[#F2B8B5] text-[13px] font-medium mt-4 text-center bg-[#601410]/20 py-2 rounded-lg border border-[#F2B8B5]/30">{error}</p>}
          </div>
        )}

        {isAuthenticated && !isFullyConfigured && (
          <div className="w-full bg-[#211F26] rounded-[28px] p-7 shadow-xl border border-[#49454F]/20">
            <h2 className="text-[22px] font-semibold mb-2 text-[#E6E1E5]">Repository Setup</h2>
            <p className="text-[14px] text-[#CAC4D0] mb-7 font-medium leading-[20px]">Hello, <strong className="text-[#D0BCFF]">{config.githubUsername}</strong>. Where should we save your solutions?</p>
            
            <form onSubmit={handleSaveRepo} className="space-y-6">
              <div>
                <label className="block text-[13px] font-bold text-[#CAC4D0] mb-2">Target Repository</label>
                <input 
                  type="text" 
                  value={repo} onChange={e => { setRepo(e.target.value); setRepoNotFound(false); setError(''); }}
                  className="w-full bg-[#141218] border border-[#938F99] rounded-[16px] px-4 py-3.5 text-[15px] text-[#E6E1E5] focus:outline-none focus:border-[#D0BCFF] focus:ring-1 focus:ring-[#D0BCFF] transition-all placeholder-[#938F99]/50"
                  placeholder="e.g. DSA-Solutions"
                  required
                />
              </div>

              {error && <p className="text-[#F2B8B5] text-[13px] font-medium mt-4 text-center bg-[#601410]/20 py-2 rounded-lg border border-[#F2B8B5]/30">{error}</p>}

              {!repoNotFound ? (
                <button 
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full bg-[#D0BCFF] hover:bg-[#EADDFF] text-[#381E72] font-bold py-[14px] rounded-[100px] transition-all shadow-md active:scale-95 disabled:opacity-70 disabled:active:scale-100 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isLoggingIn ? 'Verifying...' : 'Link Existing Repository'}
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <button 
                    type="button"
                    onClick={handleCreateRepo}
                    disabled={isLoggingIn}
                    className="w-full bg-[#b8f5a6] hover:bg-[#cbfcb9] text-[#0d3f00] font-bold py-[14px] rounded-[100px] transition-all shadow-md active:scale-95 disabled:opacity-70 disabled:active:scale-100 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isLoggingIn ? 'Creating...' : `Create + Link '${repo}' Now`}
                  </button>
                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full bg-transparent border border-[#938F99] hover:bg-[#49454F] text-[#CAC4D0] font-bold py-[14px] rounded-[100px] transition-all active:scale-95 disabled:opacity-70 disabled:active:scale-100 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Try linking again
                  </button>
                </div>
              )}
            </form>
          </div>
        )}

        {isFullyConfigured && (
          <div className="w-full flex flex-col space-y-3">
            {/* Status Card */}
            <div className="w-full bg-[#211F26] rounded-[24px] px-6 py-5 shadow-lg border border-[#49454F]/20 relative overflow-visible">
              
              <div className={`flex items-center justify-between ${totalPlatforms > 0 ? 'mb-4' : 'mb-5'}`}>
                <div className="flex items-center gap-2.5">
                  <div className="relative group/sync flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#141218] border border-[#D0BCFF]/30 cursor-help">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#D0BCFF] animate-pulse shadow-[0_0_8px_#D0BCFF]"></span>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/sync:opacity-100 group-hover/sync:visible transition-all z-[100] text-center pointer-events-none">
                      Active Sync
                    </div>
                  </div>
                  
                  <div className="flex items-center bg-[#141218] border border-[#49454F]/50 rounded-[8px] px-2 py-1.5 gap-2 shadow-inner">
                    <div className="relative group/tw flex items-center">
                      <a href={twitterUrl} target="_blank" rel="noreferrer" className="text-[#938F99] hover:text-[#E8DEF8] transition-all hover:scale-110 active:scale-95 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/></svg>
                      </a>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/tw:opacity-100 group-hover/tw:visible transition-all z-[100] pointer-events-none">
                        Share on X
                      </div>
                    </div>
                    <div className="w-[1px] h-[10px] bg-[#49454F]/50"></div>
                    <div className="relative group/li flex items-center">
                      <a href={linkedinUrl} target="_blank" rel="noreferrer" className="text-[#938F99] hover:text-[#D0BCFF] transition-all hover:scale-110 active:scale-95 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                      </a>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/li:opacity-100 group-hover/li:visible transition-all z-[100] pointer-events-none">
                        Share on LinkedIn
                      </div>
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center text-[13px] font-bold text-[#CAC4D0]">
                  <div className="relative group/rank flex items-center justify-center cursor-help mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-[22px] h-[22px] ${rankColor} transition-transform hover:scale-110`} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 8.89-7 10.02-3.87-1.13-7-5.35-7-10.02v-4.7l7-3.12z" fillRule="evenodd"/>
                    </svg>
                    <div className="absolute bottom-full right-0 mb-1.5 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/rank:opacity-100 group-hover/rank:visible transition-all z-[100] text-center pointer-events-none">
                      Rank: <span className={`${rankColor} ml-0.5`}>{rankTitle}</span>
                    </div>
                  </div>
                  <span className={`text-[#E6E1E5] font-black text-[18px] mr-1.5 ${isSyncing ? 'shimmer-value' : ''}`}>{totalSolved}</span> Total Solved
                </span>
              </div>

              {/* Platform Breakdown Bar */}
              {totalPlatforms > 0 && (
                <div className="w-full flex h-[6px] rounded-full mb-5 bg-[#49454F]/30 shadow-inner">
                  {lcWidth > 0 && (
                    <div style={{ width: `${lcWidth}%` }} className="bg-[#FFA116] hover:brightness-110 transition-all relative group/lc cursor-pointer first:rounded-l-full last:rounded-r-full">
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#FFA116]/40 shadow-2xl opacity-0 invisible group-hover/lc:opacity-100 group-hover/lc:visible transition-all z-[100] text-center pointer-events-none">
                        <span className="text-[#FFA116] mr-1">●</span>LeetCode: {lcCount}
                      </div>
                    </div>
                  )}
                  {gfgWidth > 0 && (
                    <div style={{ width: `${gfgWidth}%` }} className="bg-[#008931] hover:brightness-110 transition-all relative group/gfg cursor-pointer border-l border-[#211F26] first:border-0 first:rounded-l-full last:rounded-r-full">
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#008931]/40 shadow-2xl opacity-0 invisible group-hover/gfg:opacity-100 group-hover/gfg:visible transition-all z-[100] text-center pointer-events-none">
                        <span className="text-[#008931] mr-1">●</span>GFG: {gfgCount}
                      </div>
                    </div>
                  )}
                  {cfWidth > 0 && (
                    <div style={{ width: `${cfWidth}%` }} className="bg-[#1F8ACB] hover:brightness-110 transition-all relative group/cf cursor-pointer border-l border-[#211F26] first:border-0 first:rounded-l-full last:rounded-r-full">
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#1F8ACB]/40 shadow-2xl opacity-0 invisible group-hover/cf:opacity-100 group-hover/cf:visible transition-all z-[100] text-center pointer-events-none">
                        <span className="text-[#1F8ACB] mr-1">●</span>Codeforces: {cfCount}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Difficulty Breakdown */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: 'Basic',  key: 'basic',  color: 'text-[#D0BCFF]', bg: 'bg-[#381E72]/30', border: 'border-[#D0BCFF]/30' },
                  { label: 'Easy',   key: 'easy',   color: 'text-[#6DD58C]', bg: 'bg-[#0D3B1E]',  border: 'border-[#6DD58C]/30' },
                  { label: 'Medium', key: 'medium', color: 'text-[#F9C74F]', bg: 'bg-[#3D2E00]',  border: 'border-[#F9C74F]/30' },
                  { label: 'Hard',   key: 'hard',   color: 'text-[#F2B8B5]', bg: 'bg-[#601410]/50', border: 'border-[#F2B8B5]/30' },
                ].map(({ label, key, color, bg, border }) => (
                  <div key={key} className={`${bg} border ${border} rounded-[14px] py-2 flex flex-col items-center justify-center text-center`}>
                    <span className={`text-[18px] font-black ${color} ${isSyncing ? 'shimmer-value' : ''}`}>{config?.difficultyCounts?.[key] || 0}</span>
                    <span className={`text-[10px] font-bold ${color} opacity-80 mt-0.5`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats Grid - 2 cols */}
            <div className="grid grid-cols-2 gap-3">
              {/* Today Solved */}
              <div className="bg-[#2B2930] rounded-[20px] py-4 px-4 shadow-md border border-[#49454F]/20 flex flex-col items-center justify-center text-center group transition-transform hover:scale-[1.02]">
                <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center mb-2 shadow-sm transition-colors ${effectiveTodayCount > 0 ? 'bg-[#6DD58C] text-[#0D3B1E]' : 'bg-[#4A4458] text-[#938F99]'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-[20px] w-[20px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className={`text-[28px] leading-8 font-black tracking-tight text-[#E6E1E5] mb-1.5 ${isSyncing ? 'shimmer-value' : ''}`}>
                  {effectiveTodayCount}
                </div>
                <div className="text-[12px] font-bold text-[#CAC4D0]">Today Solved</div>
              </div>

              {/* Day Streak */}
              <div className="bg-[#2B2930] rounded-[20px] py-4 px-4 shadow-md border border-[#49454F]/20 flex flex-col items-center justify-center text-center group transition-transform hover:scale-[1.02] relative">
                <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center mb-2 shadow-sm transition-colors ${effectiveStreak > 0 ? 'bg-[#FFB4AB] text-[#690005]' : 'bg-[#4A4458] text-[#938F99]'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-[20px] w-[20px]" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className={`text-[28px] leading-8 font-black tracking-tight text-[#E6E1E5] mb-1 ${isSyncing ? 'shimmer-value' : ''}`}>
                  {effectiveStreak}
                </div>
                <div className="text-[12px] font-bold text-[#CAC4D0] mb-0.5">Day Streak</div>
                <div className="text-[10px] font-medium text-[#938F99]">Highest: {config?.streak?.maxStreak || 0}</div>
              </div>
            </div>
            
            {/* 30-Day Heatmap Strip */}
            <div className="bg-[#2B2930] rounded-[20px] py-4 px-5 shadow-md border border-[#49454F]/20 flex flex-col items-center justify-center">
              <div className="flex items-center justify-between w-full mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-[#938F99] uppercase tracking-widest">Activity Flow</span>
                  <div className="relative group/sync cursor-help flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-[13px] h-[13px] text-[#49454F] hover:text-[#D0BCFF] transition-colors ${isSyncing ? 'animate-spin text-[#D0BCFF]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <polyline points="1 20 1 14 7 14"></polyline>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max px-2.5 py-1 bg-[#141218] text-[#E6E1E5] text-[10px] font-bold rounded-[6px] border border-[#49454F] shadow-2xl opacity-0 invisible group-hover/sync:opacity-100 group-hover/sync:visible transition-all z-[100] text-center pointer-events-none">
                      Last synced: {lastSyncedAt ? formatRelativeTime(lastSyncedAt) : "Unknown"}
                    </div>
                  </div>
                </div>
                <div className="relative group cursor-help">
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center border transition-all ${config?.streak?.monthTrophies > 0 ? 'text-[#F9C74F] bg-[#3D2E00] border-[#F9C74F]/40 shadow-[0_0_8px_rgba(249,199,79,0.2)]' : 'text-[#CAC4D0]/50 bg-[#49454F]/30 border-[#49454F]'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-[10px] w-[10px] mr-1" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 3h-2V2.5A.5.5 0 0016.5 2h-9A.5.5 0 007 2.5V3H5a2 2 0 00-2 2v2c0 2.206 1.794 4 4 4h.342a6.002 6.002 0 004.658 4.898v3.102H9v2h6v-2h-3v-3.102A6.002 6.002 0 0016.658 11H17c2.206 0 4-1.794 4-4V5a2 2 0 00-2-2zm-14 4V5h2v4.621C6.037 10.062 5 8.74 5 7zm14 0c0 1.74-1.037 3.062-2 4.621V5h2v2z"/>
                    </svg>
                    {config?.streak?.monthTrophies || 0} Months
                  </span>
                  
                  <div className="absolute bottom-full right-0 mb-2 w-[160px] p-2 bg-[#141218] text-[#E6E1E5] text-[10.5px] leading-relaxed font-semibold rounded-[8px] border border-[#49454F]/80 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] text-center pointer-events-none">
                    <span className="text-[#D0BCFF] block mb-0.5">Permanent Rewards</span>
                    Maintain a 30-day streak to earn 1 permanent Month Trophy.
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between w-full gap-[3px]">
                {Array.from({ length: 30 }).map((_, i) => {
                  const d = new Date();
                  d.setDate(d.getDate() - (29 - i));
                  const dateStr = d.toLocaleDateString('en-CA');
                  const count = config?.activityHistory?.[dateStr] || 0;
                  
                  let bgClass = "bg-[#4A4458]/30"; // 0
                  if (count === 1) bgClass = "bg-[#0D3B1E]"; // 1
                  if (count === 2) bgClass = "bg-[#298345]"; // 2
                  if (count >= 3) bgClass = "bg-[#6DD58C]"; // 3+
                  
                  return (
                    <div 
                      key={dateStr}
                      className={`relative group h-[14px] flex-1 rounded-[2px] ${bgClass} transition-colors hover:ring-1 hover:ring-white/50 cursor-crosshair`}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2.5 py-1.5 bg-[#141218] text-[#E6E1E5] text-[11px] font-bold rounded-[8px] border border-[#49454F]/80 shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-[100] pointer-events-none text-center whitespace-nowrap">
                        <span className="text-[#D0BCFF] block mb-0.5 opacity-80 font-semibold text-[10px]">{dateStr}</span>
                        {count} {count === 1 ? 'problem' : 'problems'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

export default App;
