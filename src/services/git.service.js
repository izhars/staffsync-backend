// services/github.service.js
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const TOKEN    = process.env.GITHUB_TOKEN;
const REPO_URL = process.env.GITHUB_REPO_URL || process.env.REPO_URL;
const BRANCH   = process.env.GITHUB_BRANCH || process.env.BRANCH || 'main';

// ─── Path resolution (Windows + Linux safe) ────────────────────────────────
const RAW_DIR = process.env.GITHUB_PROJECT_DIR || process.env.PROJECT_DIR || '.';

// Normalize: convert backslashes to forward slashes, then resolve
const normalized = RAW_DIR.replace(/\\/g, '/');
const PROJECT_DIR = path.isAbsolute(normalized)
  ? path.normalize(normalized)
  : path.resolve(__dirname, '..', normalized);

// ─── Validate on load ──────────────────────────────────────────────────────
if (!fs.existsSync(PROJECT_DIR)) {
  console.error(`❌ GITHUB_PROJECT_DIR does not exist: "${PROJECT_DIR}"`);
  console.error(`   RAW value from .env: "${RAW_DIR}"`);
} else {
  console.log(`✅ GitHub PROJECT_DIR resolved: ${PROJECT_DIR}`);
}

function validateProjectDir() {
  if (!fs.existsSync(PROJECT_DIR)) {
    throw new Error(
      `GITHUB_PROJECT_DIR does not exist: "${PROJECT_DIR}". ` +
      `Check your .env (current value: "${RAW_DIR}").`
    );
  }
  if (!fs.statSync(PROJECT_DIR).isDirectory()) {
    throw new Error(`GITHUB_PROJECT_DIR is not a directory: "${PROJECT_DIR}"`);
  }
}

function getAuthUrl() {
  if (!TOKEN || !REPO_URL) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL missing in .env');
  }
  return REPO_URL.replace('https://', `https://${TOKEN}@`);
}


/**
 * Push entire project to GitHub
 */
async function pushToGithub(message = '') {
  const git = simpleGit(PROJECT_DIR);

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    await git.init();
    await git.addRemote('origin', getAuthUrl());
  } else {
    // Ensure remote has token
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    if (!origin || !origin.refs.push.includes('@')) {
      await git.removeRemote('origin').catch(() => {});
      await git.addRemote('origin', getAuthUrl());
    }
  }

  await git.add('./*');

  try {
    await git.commit(message || `Auto push ${new Date().toISOString()}`);
  } catch (e) {
    // nothing to commit — ignore
  }

  const pushResult = await git.push('origin', BRANCH, ['--force']);

  return {
    branch: BRANCH,
    repo: REPO_URL,
    pushedAt: new Date().toISOString(),
    result: pushResult,
  };
}

/**
 * Get current repo status
 */
async function getRepoStatus() {
  const git = simpleGit(PROJECT_DIR);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    return { initialized: false };
  }
  const status = await git.status();
  const log = await git.log({ maxCount: 5 });
  return {
    initialized: true,
    branch: status.current,
    modified: status.modified,
    not_added: status.not_added,
    ahead: status.ahead,
    behind: status.behind,
    recentCommits: log.all.map(c => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      date: c.date,
      author: c.author_name,
    })),
  };
}

module.exports = { pushToGithub, getRepoStatus };