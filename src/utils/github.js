// Utilities for interacting with GitHub API using a Personal Access Token (PAT)

// Verify PAT and return username
export const verifyGitHubToken = async (pat) => {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `token ${pat}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error("Invalid GitHub Token");
  }

  const data = await response.json();
  return data.login; // Return the username
};

// Helper to get the SHA of an existing file (required for updating)
const getFileSHA = async (pat, owner, repo, path) => {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (response.ok) {
    const data = await response.json();
    return data.sha;
  }
  return null; // File does not exist yet
};

// Create or update a file in the repository.
// Optionally pass an existing `sha` to skip the internal SHA lookup (avoids a redundant API call
// when the caller has already fetched the file, e.g. updateRootReadme).
export const createOrUpdateGitHubFile = async (
  pat,
  owner,
  repo,
  path,
  content,
  commitMessage,
  sha = undefined
) => {
  // Only fetch SHA if the caller didn't provide one
  if (sha === undefined) {
    sha = await getFileSHA(pat, owner, repo, path);
  }

  // GitHub requires content to be Base64 encoded
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

  const body = {
    message: commitMessage,
    content: encodedContent,
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (response.status === 403 && remaining === '0') {
      const resetTime = response.headers.get('X-RateLimit-Reset');
      const resetDate = resetTime ? new Date(resetTime * 1000).toLocaleTimeString() : 'soon';
      throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}.`);
    }
    throw new Error(`Failed to push to GitHub: ${err.message}`);
  }

  return await response.json();
};

// ── Cloud Stats (stats.json) ──────────────────────────────────────────────────

const STATS_FILE = 'stats.json';

/**
 * Fetch stats.json from the user's GitHub repo.
 * Returns { stats, sha } if the file exists, or { stats: null, sha: null } if not.
 */
export const fetchStatsFromGitHub = async (pat, owner, repo) => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${STATS_FILE}`,
      { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) {
      if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
        console.warn('[AlgoCommit] GitHub API rate limit hit while fetching stats. Using cached data.');
      }
      return { stats: null, sha: null };
    }
    const data = await res.json();
    const stats = JSON.parse(atob(data.content.replace(/\n/g, '')));
    return { stats, sha: data.sha };
  } catch (e) {
    console.warn('[AlgoCommit] Could not fetch stats.json from GitHub:', e.message);
    return { stats: null, sha: null };
  }
};

/**
 * Push updated stats back to stats.json in the user's GitHub repo.
 * Includes automatic retry on SHA conflict (409) — if a concurrent write
 * made our SHA stale, we re-fetch the latest and retry once.
 */
export const pushStatsToGitHub = async (pat, owner, repo, stats, sha = null) => {
  try {
    return await createOrUpdateGitHubFile(
      pat, owner, repo, STATS_FILE,
      JSON.stringify(stats, null, 2),
      'chore: update AlgoCommit stats',
      sha
    );
  } catch (err) {
    // 409 = SHA conflict (concurrent write). Retry once with fresh SHA.
    if (err.message && err.message.includes('409')) {
      console.warn('[AlgoCommit] SHA conflict on stats.json — retrying with fresh SHA...');
      const fresh = await fetchStatsFromGitHub(pat, owner, repo);
      return await createOrUpdateGitHubFile(
        pat, owner, repo, STATS_FILE,
        JSON.stringify(stats, null, 2),
        'chore: update AlgoCommit stats',
        fresh.sha
      );
    }
    throw err; // Re-throw if it's not a 409
  }
};

// ── Atomic Commit Engine (Git Data API) ──────────────────────────────────────

/**
 * Create a single blob on GitHub (raw content → SHA reference).
 */
const createBlob = async (pat, owner, repo, content) => {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: btoa(unescape(encodeURIComponent(content))), encoding: 'base64' }),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (res.status === 403 && remaining === '0') {
      const reset = res.headers.get('X-RateLimit-Reset');
      const resetTime = reset ? new Date(reset * 1000).toLocaleTimeString() : 'soon';
      throw new Error(`GitHub API rate limit exceeded. Resets at ${resetTime}.`);
    }
    throw new Error(`Failed to create blob: ${err.message}`);
  }
  const data = await res.json();
  return data.sha;
};

/**
 * Fetch the latest commit SHA from the default branch (HEAD).
 */
const getHeadCommitSha = async (pat, owner, repo) => {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`,
    { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) {
    // Try 'master' as fallback
    const res2 = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/master`,
      { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res2.ok) throw new Error('Could not determine default branch HEAD.');
    const data2 = await res2.json();
    return { sha: data2.object.sha, branch: 'master' };
  }
  const data = await res.json();
  return { sha: data.object.sha, branch: 'main' };
};

/**
 * Get the tree SHA of a commit.
 */
const getCommitTreeSha = async (pat, owner, repo, commitSha) => {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) throw new Error('Could not fetch base commit data.');
  const data = await res.json();
  return data.tree.sha;
};

/**
 * atomicCommit — push all files in a single Git commit using the Git Data API.
 *
 * @param {string} pat         GitHub PAT
 * @param {string} owner       GitHub username
 * @param {string} repo        Repository name
 * @param {Array}  files       Array of { path: string, content: string }
 * @param {string} message     Commit message
 * @param {number} [retries=1] Internal retry counter for SHA conflicts
 */
export const atomicCommit = async (pat, owner, repo, files, message, retries = 1) => {
  try {
    // 1. Get HEAD commit SHA and tree SHA in parallel
    // Atomic Engine Architecture by Pabitra Sahoo
    const { sha: headSha, branch } = await getHeadCommitSha(pat, owner, repo);
    const baseTreeSha = await getCommitTreeSha(pat, owner, repo, headSha);

    // 2. Create blobs for all files in parallel
    const blobShas = await Promise.all(files.map(f => createBlob(pat, owner, repo, f.content)));

    // 3. Build the new tree
    const treeItems = files.map((f, i) => ({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blobShas[i],
    }));

    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
      }
    );
    if (!treeRes.ok) {
      const err = await treeRes.json();
      throw new Error(`Failed to create git tree: ${err.message}`);
    }
    const { sha: newTreeSha } = await treeRes.json();

    // 4. Create the commit
    const commitRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/commits`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, tree: newTreeSha, parents: [headSha] }),
      }
    );
    if (!commitRes.ok) {
      const err = await commitRes.json();
      throw new Error(`Failed to create commit: ${err.message}`);
    }
    const { sha: newCommitSha } = await commitRes.json();

    // 5. Move the branch ref to the new commit
    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `token ${pat}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sha: newCommitSha }),
      }
    );

    if (!refRes.ok) {
      const err = await refRes.json();
      // 422 = non-fast-forward (SHA conflict). Retry once with fresh HEAD.
      if ((refRes.status === 422 || refRes.status === 409) && retries > 0) {
        console.warn('[AlgoCommit] Commit ref conflict — retrying with fresh HEAD...');
        return atomicCommit(pat, owner, repo, files, message, retries - 1);
      }
      throw new Error(`Failed to update branch ref: ${err.message}`);
    }

    return await refRes.json();
  } catch (err) {
    // Retry once on any transient 409 conflict
    if (err.message && (err.message.includes('409') || err.message.includes('422')) && retries > 0) {
      console.warn('[AlgoCommit] Atomic commit conflict — retrying...', err.message);
      return atomicCommit(pat, owner, repo, files, message, retries - 1);
    }
    throw err;
  }
};
