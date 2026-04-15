// GitHub plugin -- owns every /api/github/* route + /api/pull-request.
//
// Registers at absolute paths (not under /api/plugins/github/) so the URL
// contracts the frontend and AI already use keep working after extraction.
// When this plugin is uninstalled / unconfigured, the core route gate 404s
// the same URLs with pluginRequired: 'github'. See the main DevOps Pilot
// repo, feature/plugin-first-shell branch.

module.exports = function register(ctx) {
  const { shell } = ctx;
  const { https, fs, path, execSync, gitExec, sanitizeText, permGate, incognitoGuard, getRepoPath } = shell;

  // --- Helpers -------------------------------------------------------------

  function parseGitHubRemote(repoPath) {
    try {
      const url = gitExec(repoPath, 'remote get-url origin');
      const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      return m ? { owner: m[1], repo: m[2] } : null;
    } catch (_) { return null; }
  }

  function resolveGitHub(repoName) {
    const repoPath = getRepoPath(repoName);
    if (!repoPath) return { error: 'Repo not found' };
    const gh = parseGitHubRemote(repoPath);
    if (!gh) return { error: 'Not a GitHub repository' };
    return gh;
  }

  function ghRequest(method, apiPath, body, accept) {
    return new Promise((resolve, reject) => {
      const cfg = ctx.getConfig();
      const pat = cfg.GitHubPAT;
      if (!pat) return reject(new Error('GitHub PAT not configured. Set it in Settings > Plugins > GitHub.'));
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': accept || 'application/vnd.github+json',
          'User-Agent': 'DevOps-Pilot',
          'Content-Type': 'application/json',
        },
      };
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => { data += c; });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
          } else {
            const msg = resp.statusCode === 401
              ? 'GitHub auth failed -- PAT may be expired or invalid'
              : `GitHub API error (${resp.statusCode}): ${data.slice(0, 300)}`;
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  const json = (res, data, status) => {
    res.writeHead(status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // --- Route handlers ------------------------------------------------------

  function handleRepoInfo(req, res, url) {
    const gh = resolveGitHub(url.searchParams.get('repo'));
    if (gh.error) return json(res, gh, 400);
    json(res, gh);
  }

  async function handlePulls(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub pull requests')) return;
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const state = url.searchParams.get('state') || 'open';
      const cacheKey = `github:pulls:${gh.owner}/${gh.repo}:${state}`;
      const result = ctx.cache
        ? await ctx.cache.get(cacheKey, async () => fetchPulls(gh, state))
        : await fetchPulls(gh, state);
      json(res, result);
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function fetchPulls(gh, state) {
    const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`);
    const reviewResults = await Promise.all(data.map(pr =>
      ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${pr.number}/reviews`).catch(() => [])
    ));
    const pulls = data.map((pr, i) => {
      const reviews = reviewResults[i] || [];
      const byUser = {};
      for (const r of reviews) {
        if (r.state && r.state !== 'PENDING' && r.state !== 'COMMENTED') byUser[r.user && r.user.login] = r.state;
      }
      const reviewStates = Object.values(byUser);
      const reviewStatus = reviewStates.includes('CHANGES_REQUESTED') ? 'changes_requested'
        : reviewStates.includes('APPROVED') ? 'approved' : null;
      return {
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
        author: (pr.user && pr.user.login) || '', authorAvatar: (pr.user && pr.user.avatar_url) || '',
        createdAt: pr.created_at, updatedAt: pr.updated_at,
        headRef: (pr.head && pr.head.ref) || '', baseRef: (pr.base && pr.base.ref) || '',
        labels: (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
        reviewers: (pr.requested_reviewers || []).map(r => r.login),
        additions: pr.additions, deletions: pr.deletions,
        comments: (pr.comments || 0) + (pr.review_comments || 0),
        reviewStatus,
      };
    });
    return { pulls };
  }

  async function handlePullDetail(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub pull request detail')) return;
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [pr, reviews] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}`, null, 'application/vnd.github.html+json'),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/reviews`).catch(() => []),
      ]);
      const byUser = {};
      for (const r of reviews) {
        if (r.state && r.state !== 'PENDING' && r.state !== 'COMMENTED') byUser[r.user && r.user.login] = r.state;
      }
      const reviewStates = Object.values(byUser);
      const reviewStatus = reviewStates.includes('CHANGES_REQUESTED') ? 'changes_requested'
        : reviewStates.includes('APPROVED') ? 'approved' : null;
      json(res, {
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
        body: pr.body || '', bodyHtml: pr.body_html || '',
        mergeable: pr.mergeable, merged: pr.merged,
        author: (pr.user && pr.user.login) || '', authorAvatar: (pr.user && pr.user.avatar_url) || '',
        createdAt: pr.created_at, updatedAt: pr.updated_at,
        headRef: (pr.head && pr.head.ref) || '', baseRef: (pr.base && pr.base.ref) || '',
        additions: pr.additions, deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
        reviewers: (pr.requested_reviewers || []).map(r => r.login),
        htmlUrl: pr.html_url || '',
        reviewStatus,
        comments: (pr.comments || 0) + (pr.review_comments || 0),
      });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullFiles(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub pull request files')) return;
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/files?per_page=100`);
      const files = data.map(f => ({
        filename: f.filename, status: f.status,
        additions: f.additions, deletions: f.deletions,
        patch: f.patch || null,
      }));
      json(res, { files });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullComments(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub pull request comments')) return;
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [issueComments, reviewComments] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/comments?per_page=100`),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/comments?per_page=100`),
      ]);
      const all = [
        ...issueComments.map(c => ({ id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '', body: c.body, createdAt: c.created_at, type: 'comment' })),
        ...reviewComments.map(c => ({ id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '', body: c.body, createdAt: c.created_at, type: 'review', path: c.path, line: c.line })),
      ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      json(res, { comments: all });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullTimeline(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub pull request timeline')) return;
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [data, reviewComments] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/timeline?per_page=100`, null, 'application/vnd.github.html+json'),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/comments?per_page=100`),
      ]);
      const reviewCommentsMap = {};
      for (const c of reviewComments) {
        const rid = c.pull_request_review_id;
        if (!rid) continue;
        if (!reviewCommentsMap[rid]) reviewCommentsMap[rid] = [];
        reviewCommentsMap[rid].push({
          id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '',
          body: c.body || '', bodyHtml: c.body_html || '',
          path: c.path || '', line: c.line || c.original_line || null,
          createdAt: c.created_at || '',
          diffHunk: c.diff_hunk || '',
        });
      }
      const events = [];
      for (const e of data) {
        const ev = { type: e.event || (e.node_id && e.node_id.split('/')[0]) || 'unknown', createdAt: e.created_at || e.submitted_at || e.timestamp || '' };
        if (e.event === 'commented' || (!e.event && e.body !== undefined)) {
          ev.type = 'commented';
          ev.author = (e.user && e.user.login) || (e.actor && e.actor.login) || '';
          ev.avatar = (e.user && e.user.avatar_url) || (e.actor && e.actor.avatar_url) || '';
          ev.body = e.body || '';
          ev.bodyHtml = e.body_html || '';
        } else if (e.event === 'reviewed') {
          ev.author = (e.user && e.user.login) || '';
          ev.avatar = (e.user && e.user.avatar_url) || '';
          ev.state = e.state;
          ev.body = e.body || '';
          ev.bodyHtml = e.body_html || '';
          const rid = e.id;
          if (rid && reviewCommentsMap[rid]) {
            ev.comments = reviewCommentsMap[rid];
            delete reviewCommentsMap[rid];
          }
        } else if (e.event === 'committed') {
          ev.sha = e.sha;
          ev.message = e.message;
          ev.author = (e.author && e.author.name) || '';
        } else if (e.event === 'review_requested') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.reviewer = (e.requested_reviewer && e.requested_reviewer.login) || '';
        } else if (e.event === 'assigned' || e.event === 'unassigned') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.assignee = (e.assignee && e.assignee.login) || '';
        } else if (e.event === 'labeled' || e.event === 'unlabeled') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.label = (e.label && e.label.name) || '';
          ev.labelColor = (e.label && e.label.color) || '';
        } else if (e.event === 'head_ref_force_pushed' || e.event === 'head_ref_deleted') {
          ev.actor = (e.actor && e.actor.login) || '';
        } else if (e.event === 'merged') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.commitId = e.commit_id || '';
        } else if (e.event === 'closed' || e.event === 'reopened') {
          ev.actor = (e.actor && e.actor.login) || '';
        } else {
          ev.actor = (e.actor && e.actor.login) || '';
        }
        events.push(ev);
      }
      for (const [, comments] of Object.entries(reviewCommentsMap)) {
        for (const c of comments) {
          events.push({
            type: 'review_comment', createdAt: c.createdAt,
            author: c.author, avatar: c.avatar,
            body: c.body, bodyHtml: c.bodyHtml,
            path: c.path, line: c.line, diffHunk: c.diffHunk,
          });
        }
      }
      events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      json(res, { events });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleAddComment(req, res) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'comment on pull request')) return;
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/comment', 'Comment on GitHub PR'))) return;
      const { repo, number, body } = await ctx.readBody(req);
      if (!repo || !number || !body) return json(res, { error: 'repo, number, and body are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/issues/${number}/comments`, { body: sanitizeText(body) });
      json(res, { ok: true, id: result.id });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleSubmitReview(req, res) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'submit pull request review')) return;
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/review', 'Submit GitHub PR review'))) return;
      const { repo, number, event, body } = await ctx.readBody(req);
      if (!repo || !number || !event) return json(res, { error: 'repo, number, and event are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = { event };
      if (body) payload.body = sanitizeText(body);
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/reviews`, payload);
      json(res, { ok: true, state: result.state });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  function handleImageProxy(req, res, url) {
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl || !imgUrl.startsWith('https://github.com/')) {
      res.writeHead(400); res.end('Invalid URL'); return;
    }
    const cfg = ctx.getConfig();
    const pat = cfg.GitHubPAT;
    const parsed = new URL(imgUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'Authorization': `token ${pat}`, 'User-Agent': 'DevOps-Pilot', 'Accept': '*/*' },
    };
    const proxy = https.request(options, (upstream) => {
      if (upstream.statusCode === 301 || upstream.statusCode === 302) {
        const loc = upstream.headers.location;
        if (loc) {
          const redir = new URL(loc);
          const redirOpts = {
            hostname: redir.hostname,
            path: redir.pathname + redir.search,
            method: 'GET',
            headers: { 'User-Agent': 'DevOps-Pilot', 'Accept': '*/*' },
          };
          const r2 = https.request(redirOpts, (resp2) => {
            res.writeHead(resp2.statusCode, {
              'Content-Type': resp2.headers['content-type'] || 'image/png',
              'Cache-Control': 'public, max-age=3600',
            });
            resp2.pipe(res);
          });
          r2.on('error', () => { res.writeHead(502); res.end(); });
          r2.end();
          return;
        }
      }
      res.writeHead(upstream.statusCode, {
        'Content-Type': upstream.headers['content-type'] || 'image/png',
        'Cache-Control': 'public, max-age=3600',
      });
      upstream.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end(); });
    proxy.end();
  }

  async function handleUserRepos(req, res, url) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'read GitHub repositories')) return;
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const page = parseInt(url.searchParams.get('page')) || 1;
      const perPage = 50;
      const repos = await ghRequest('GET', `/user/repos?sort=pushed&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`);
      const items = repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description || '',
        private: r.private,
        clone_url: r.clone_url,
        ssh_url: r.ssh_url,
        html_url: r.html_url,
        default_branch: r.default_branch,
        pushed_at: r.pushed_at,
        language: r.language,
      }));
      const filtered = query ? items.filter(r =>
        r.name.toLowerCase().includes(query) || r.full_name.toLowerCase().includes(query)
      ) : items;
      json(res, { repos: filtered, page, hasMore: repos.length === perPage });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleClone(req, res) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'clone GitHub repository')) return;
      const { cloneUrl, destPath } = await ctx.readBody(req);
      if (!cloneUrl || !destPath) return json(res, { error: 'cloneUrl and destPath are required' }, 400);
      if (!fs.existsSync(destPath)) return json(res, { error: `Destination does not exist: ${destPath}` }, 400);
      const match = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
      const repoFolder = match ? match[1] : 'repo';
      const fullDest = path.join(destPath, repoFolder);
      if (fs.existsSync(fullDest)) return json(res, { error: `Folder already exists: ${fullDest}` }, 400);
      const cfg = ctx.getConfig();
      let authUrl = cloneUrl;
      if (cfg.GitHubPAT && cloneUrl.startsWith('https://')) {
        authUrl = cloneUrl.replace('https://', `https://${cfg.GitHubPAT}@`);
      }
      execSync(`git clone "${authUrl}" "${fullDest}"`, { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
      json(res, { ok: true, path: fullDest, name: repoFolder });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleCreatePullRequest(req, res) {
    try {
      if (incognitoGuard && incognitoGuard(res, 'create pull request')) return;
      if (permGate && !(await permGate(res, 'api', 'POST /api/pull-request', 'Create pull request'))) return;
      const { repoName, title, description, sourceBranch, targetBranch, workItemId } = await ctx.readBody(req);
      const cfg = ctx.getConfig();
      if (!repoName) return json(res, { error: 'repoName is required' }, 400);
      if (!title)    return json(res, { error: 'title is required' }, 400);
      const gh = resolveGitHub(repoName);
      if (gh.error) return json(res, gh, 400);
      let source = sourceBranch;
      if (!source) {
        const repoPath = cfg.Repos && cfg.Repos[repoName];
        if (repoPath) { try { source = gitExec(repoPath, 'rev-parse --abbrev-ref HEAD'); } catch (_) {} }
      }
      if (!source) return json(res, { error: 'Could not determine source branch' }, 400);
      const target = targetBranch || 'main';
      let body = description || '';
      if (workItemId) {
        // Cross-plugin soft reference: if the Azure DevOps plugin is configured,
        // link to the work item in ADO. Otherwise just record the AB# text.
        const adoOrg = cfg.AzureDevOpsOrg;
        const adoProject = cfg.AzureDevOpsProject;
        if (adoOrg && adoProject) {
          const adoUrl = `https://dev.azure.com/${adoOrg}/${encodeURIComponent(adoProject)}/_workitems/edit/${workItemId}`;
          body += `${body ? '\n\n' : ''}AB#${workItemId} - [View in Azure DevOps](${adoUrl})`;
        } else {
          body += `${body ? '\n\n' : ''}AB#${workItemId}`;
        }
      }
      const pr = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls`, {
        title: sanitizeText(title),
        body: sanitizeText(body),
        head: source,
        base: target,
      });
      json(res, { ok: true, pullRequestId: pr.number, url: pr.html_url, title: pr.title });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  // --- Absolute route registration -----------------------------------------

  ctx.addAbsoluteRoute('GET',  '/api/github/repo-info',     handleRepoInfo);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls',         handlePulls);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/detail',  handlePullDetail);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/files',   handlePullFiles);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/comments',handlePullComments);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/timeline',handlePullTimeline);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/comment', handleAddComment);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/review',  handleSubmitReview);
  ctx.addAbsoluteRoute('GET',  '/api/github/image',         handleImageProxy);
  ctx.addAbsoluteRoute('GET',  '/api/github/user-repos',    handleUserRepos);
  ctx.addAbsoluteRoute('POST', '/api/github/clone',         handleClone);
  ctx.addAbsoluteRoute('POST', '/api/pull-request',         handleCreatePullRequest);
};
