# Release process

This repository publishes npm releases from the tag-triggered GitHub Actions
workflow at `.github/workflows/release.yml`.

## 0.4.0 npm publishing setup

Before tagging `v0.4.0`, an npm package owner must authorise this repository as
the trusted publisher for the `jurisd` package:

```bash
npm trust github jurisd --repo russellbrenner/jurisd --file release.yml --environment npm-publish --allow-publish
```

The trusted publisher must match:

- package: `jurisd`
- repository: `russellbrenner/jurisd`
- workflow filename: `release.yml`
- GitHub environment: `npm-publish`
- allowed action: `npm publish`

The repository also needs a GitHub environment named `npm-publish`. Configure it
with reviewer protection before tagging a release. For API-driven setup, use the
GitHub Environments REST endpoint through `gh api` and bind the npm trusted
publisher to that same environment.

The release workflow uses GitHub OIDC, so it does not need an `NPM_TOKEN` secret.
The workflow runs on GitHub-hosted Ubuntu, validates that the tag matches
`package.json`, builds and tests without OIDC permission, uploads the verified
tarball as an artifact, then grants `id-token: write` only to the protected
`npm-publish` job that runs `npm publish *.tgz --access public`. The GitHub
release is created only after npm publish succeeds.

After the package exists on npm, staged publishing can be evaluated for later
releases with `npm stage publish` and an `--allow-stage-publish` trusted
publisher permission. The first `jurisd` package publication uses direct trusted
publishing because staged publishing requires an existing package.

## Tagging a release

1. Confirm `package.json`, `package-lock.json`, and `CHANGELOG.md` contain the
   release version.
2. Confirm the `npm-publish` GitHub environment is protected.
3. Confirm the trusted publisher is configured on npm with `--environment
   npm-publish`.
4. Create and push the tag:

   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```

5. Confirm the release workflow completed.
6. Confirm the package is visible:

   ```bash
   npm view jurisd@0.4.0 version
   ```

If trusted publishing is not configured, `npm publish` must fail rather than
falling back to a long-lived token.
