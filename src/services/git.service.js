// services/github.service.js
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const TOKEN    = process.env.GITHUB_TOKEN;
const REPO_URL = process.env.GITHUB_REPO_URL || process.env.REPO_URL;
const BRANCH   = process.env.GITHUB_BRANCH || process.env.BRANCH || 'main';

// ─── Path resolution (Windows + Linux safe) ────────────────────────────────
const RAW_DIR = process.env.GITHUB_PROJECT_DIR || process.env.PROJECT_DIR || '.';
const normalized = RAW_DIR.replace(/\\/g, '/');
const PROJECT_DIR = path.isAbsolute(normalized)
  ? path.normalize(normalized)
  : path.resolve(__dirname, '..', normalized);

if (!fs.existsSync(PROJECT_DIR)) {
  console.error(`❌ GITHUB_PROJECT_DIR does not exist: "${PROJECT_DIR}" (raw: "${RAW_DIR}")`);
} else {
  console.log(`✅ GitHub PROJECT_DIR resolved: ${PROJECT_DIR}`);
}

function validateProjectDir() {
  if (!fs.existsSync(PROJECT_DIR)) {
    throw new Error(`GITHUB_PROJECT_DIR does not exist: "${PROJECT_DIR}" (raw: "${RAW_DIR}")`);
  }
  if (!fs.statSync(PROJECT_DIR).isDirectory()) {
    throw new Error(`GITHUB_PROJECT_DIR is not a directory: "${PROJECT_DIR}"`);
  }
}

function validateEnv() {
  if (!TOKEN || !REPO_URL) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL missing in .env');
  }
}

function getAuthUrl() {
  validateEnv();
  return REPO_URL.replace('https://', `https://${TOKEN}@`);
}

/** Strip token from any error message before it leaves this module */
function sanitizeError(err) {
  let msg = err?.message || String(err);
  if (TOKEN) msg = msg.split(TOKEN).join('***');
  return msg;
}

/**
 * Push entire project to GitHub.
 * Recovers remote history on a fresh/lost .git dir instead of nuking it.
 */
async function pushToGithub(message = '') {
  validateProjectDir();
  validateEnv();

  const git = simpleGit(PROJECT_DIR);
  const isRepo = await git.checkIsRepo();

  try {
    if (!isRepo) {
      await git.init();
      await git.checkoutLocalBranch(BRANCH);
      await git.addRemote('origin', getAuthUrl());

      try {
        await git.fetch('origin', BRANCH);
        await git.reset(['--soft', `origin/${BRANCH}`]);
      } catch {
        console.warn(`⚠️ No existing remote branch "${BRANCH}" found — starting fresh history.`);
      }
    } else {
      // Update URL WITHOUT dropping remote-tracking refs
      const remotes = await git.getRemotes(true);
      if (remotes.some(r => r.name === 'origin')) {
        await git.remote(['set-url', 'origin', getAuthUrl()]);
      } else {
        await git.addRemote('origin', getAuthUrl());
      }

      // Refresh tracking refs so --force-with-lease has something valid to lease against
      try {
        await git.fetch('origin', BRANCH);
      } catch {
        console.warn(`⚠️ Fetch failed for "${BRANCH}" — remote branch may not exist yet.`);
      }
    }

    await git.add('.');

    try {
      await git.commit(message || `Auto push ${new Date().toISOString()}`);
    } catch {
      // nothing to commit
    }

    // Use explicit lease form — works even without a configured upstream
    let leaseArg = '--force-with-lease';
    try {
      const remoteSha = (await git.revparse([`origin/${BRANCH}`])).trim();
      leaseArg = `--force-with-lease=${BRANCH}:${remoteSha}`;
    } catch {
      // No remote ref yet (first push) — plain force-with-lease is fine
    }

    const pushResult = await git.push('origin', BRANCH, [leaseArg]);

    return {
      branch: BRANCH,
      repo: REPO_URL,
      pushedAt: new Date().toISOString(),
      result: pushResult,
    };
  } catch (err) {
    throw new Error(sanitizeError(err));
  }
}

/**
 * Get current repo status
 */
async function getRepoStatus() {
  validateProjectDir();

  const git = simpleGit(PROJECT_DIR);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    return { initialized: false };
  }

  try {
    const status = await git.status();
    const log = await git.log({ maxCount: 5 }).catch(() => ({ all: [] })); // empty repo has no log

    return {
      initialized: true,
      branch: status.current,
      modified: status.modified,
      not_added: status.not_added,
      ahead: status.ahead,
      behind: status.behind,
      repo: REPO_URL,
      recentCommits: log.all.map(c => ({
        hash: c.hash.slice(0, 7),
        message: c.message,
        date: c.date,
        author: c.author_name,
      })),
    };
  } catch (err) {
    throw new Error(sanitizeError(err));
  }
}

module.exports = { pushToGithub, getRepoStatus };