# Simple local script to verify code and push to GitHub (which triggers the TEST pipeline)

# 1. Check for errors (Lint and Type Check)
echo "Checking for errors..."
npm run lint
if ($LASTEXITCODE -ne 0) {
    echo "Errors found! Please fix them before deploying."
    exit $LASTEXITCODE
}

# 2. Stage all changes
echo "Staging changes..."
git add .

# 3. Prompt for commit message
$commitMsg = Read-Host -Prompt 'Enter commit message'
if (-not $commitMsg) { $commitMsg = "Deploy to test: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

# 4. Commit changes
echo "Committing changes..."
git commit -m "$commitMsg"

# 5. Push to GitHub (This triggers the .github/workflows/test-deploy.yml automatically)
echo "Pushing to GitHub..."
git push origin main

echo "Done! The GitHub Action 'Deploy Test' has been triggered."
echo "You can monitor the progress here: https://github.com/restartourloveapp/RoL-2026-03/actions"
