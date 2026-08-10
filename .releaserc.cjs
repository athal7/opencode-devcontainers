module.exports = {
  branches: [
    'main'
  ],
  
  plugins: [
    // Analyze commits to determine release type
    // While in 0.x, breaking changes bump minor (not major) per semver spec
    ['@semantic-release/commit-analyzer', {
      releaseRules: [
        { breaking: true, release: 'minor' },
        { type: 'feat', release: 'minor' },
        { type: 'fix', release: 'patch' },
        { type: 'perf', release: 'patch' },
        { type: 'refactor', release: 'patch' },
      ]
    }],
    
    // Generate release notes
    '@semantic-release/release-notes-generator',
    
    // Publish to npm with provenance. package.json's committed version
    // stays a placeholder (0.0.0-development) — semantic-release sets
    // the real version only in this ephemeral CI checkout before
    // `npm publish`, and never commits it back to the repo. No PR, no
    // committed version file, ever; the npm registry and git tags are
    // the only sources of truth for the release version.
    ['@semantic-release/npm', { provenance: true }],

    // Create GitHub release directly from HEAD's tree (no version-bump
    // commit precedes it)
    '@semantic-release/github'
  ]
};
